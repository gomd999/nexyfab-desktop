//! Bounded, native-only BYOK provider execution.
//!
//! Provider credentials and provider replay history remain native-only. The
//! web layer receives normalized text/tool calls plus an opaque, bounded
//! in-memory state handle for the next turn.

use crate::ai_credentials::{self, ErrorCode as CredentialErrorCode, Provider};
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use uuid::Uuid;

const OPENAI_ENDPOINT: &str = "https://api.openai.com/v1/responses";
const ANTHROPIC_ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_MODEL_BYTES: usize = 128;
const MAX_INSTRUCTIONS_BYTES: usize = 32 * 1024;
const MAX_INPUT_ITEMS: usize = 128;
const MAX_INPUT_ITEM_BYTES: usize = 32 * 1024;
const MAX_TOTAL_INPUT_BYTES: usize = 128 * 1024;
const MAX_TOOLS: usize = 32;
const MAX_TOOL_NAME_BYTES: usize = 128;
const MAX_TOOL_DESCRIPTION_BYTES: usize = 4096;
const MAX_TOOL_SCHEMA_BYTES: usize = 64 * 1024;
const MAX_TOTAL_TOOL_SCHEMA_BYTES: usize = 128 * 1024;
const MAX_PRIOR_STATE_BYTES: usize = 512 * 1024;
const MAX_RESPONSE_BODY_BYTES: usize = 512 * 1024;
const MAX_RESPONSE_TEXT_BYTES: usize = 256 * 1024;
const MAX_TOOL_ARGUMENT_BYTES: usize = 64 * 1024;
const MAX_PROVIDER_STATES: usize = 64;
const PROVIDER_STATE_TTL: Duration = Duration::from_secs(30 * 60);

static PROVIDER_STATES: OnceLock<Mutex<HashMap<String, NativeProviderState>>> = OnceLock::new();

#[derive(Clone, Debug)]
struct NativeProviderState {
    provider: Provider,
    model: String,
    data: Value,
    created_at: Instant,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiAgentTurnRequest {
    pub provider: String,
    pub model: String,
    pub instructions: String,
    #[serde(alias = "messages")]
    pub input: Vec<AgentInputItem>,
    #[serde(default)]
    #[serde(alias = "tool_definitions")]
    pub tools: Vec<CadToolDefinition>,
    #[serde(default)]
    pub prior_provider_state: Option<PriorProviderState>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AgentInputItem {
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub call_id: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub is_error: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CadToolDefinition {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub parameters: Value,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct PriorProviderState {
    pub handle: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NormalizedToolCall {
    pub call_id: String,
    pub name: String,
    pub arguments: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FinishStatus {
    Completed,
    ToolCalls,
    Incomplete,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AiAgentTurnResult {
    pub assistant_text: String,
    pub tool_calls: Vec<NormalizedToolCall>,
    pub provider_continuation_id: Option<String>,
    pub provider_state: Option<PriorProviderState>,
    pub finish_status: FinishStatus,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentErrorCode {
    InvalidProvider,
    InvalidInput,
    InvalidModel,
    InvalidTool,
    InvalidState,
    InputTooLarge,
    KeyringUnavailable,
    CredentialMissing,
    ProviderUnauthorized,
    ProviderForbidden,
    ProviderRateLimited,
    ProviderTimeout,
    ProviderNetwork,
    ProviderHttp,
    InvalidResponse,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct AgentError {
    pub code: AgentErrorCode,
}

impl AgentError {
    const fn new(code: AgentErrorCode) -> Self {
        Self { code }
    }
}

fn map_credential_error(error: CredentialErrorCode) -> AgentError {
    let code = match error {
        CredentialErrorCode::InvalidProvider => AgentErrorCode::InvalidProvider,
        CredentialErrorCode::CredentialMissing => AgentErrorCode::CredentialMissing,
        CredentialErrorCode::KeyringUnavailable => AgentErrorCode::KeyringUnavailable,
        _ => AgentErrorCode::KeyringUnavailable,
    };
    AgentError::new(code)
}

fn bounded_text(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}

fn bounded_multiline_text(value: &str, limit: usize) -> bool {
    !value.is_empty()
        && value.len() <= limit
        && !value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
}

fn valid_tool_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TOOL_NAME_BYTES
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

fn provider_states() -> &'static Mutex<HashMap<String, NativeProviderState>> {
    PROVIDER_STATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn prune_provider_states(states: &mut HashMap<String, NativeProviderState>) {
    states.retain(|_, state| state.created_at.elapsed() <= PROVIDER_STATE_TTL);
    while states.len() >= MAX_PROVIDER_STATES {
        let oldest = states
            .iter()
            .min_by_key(|(_, state)| state.created_at)
            .map(|(handle, _)| handle.clone());
        if let Some(handle) = oldest {
            states.remove(&handle);
        } else {
            break;
        }
    }
}

fn store_provider_state(
    provider: Provider,
    model: &str,
    data: Value,
) -> Result<PriorProviderState, AgentError> {
    let handle = format!("agent-state-{}", Uuid::new_v4());
    let mut states = provider_states()
        .lock()
        .map_err(|_| AgentError::new(AgentErrorCode::InvalidState))?;
    prune_provider_states(&mut states);
    states.insert(
        handle.clone(),
        NativeProviderState {
            provider,
            model: model.to_string(),
            data,
            created_at: Instant::now(),
        },
    );
    Ok(PriorProviderState { handle })
}

fn load_provider_state(
    state: &PriorProviderState,
    provider: Provider,
    model: &str,
) -> Result<Value, AgentError> {
    if !bounded_text(&state.handle, 160) {
        return Err(AgentError::new(AgentErrorCode::InvalidState));
    }
    let mut states = provider_states()
        .lock()
        .map_err(|_| AgentError::new(AgentErrorCode::InvalidState))?;
    prune_provider_states(&mut states);
    let stored = states
        .get(&state.handle)
        .ok_or_else(|| AgentError::new(AgentErrorCode::InvalidState))?;
    if stored.provider != provider || stored.model != model {
        return Err(AgentError::new(AgentErrorCode::InvalidState));
    }
    Ok(stored.data.clone())
}

fn remove_provider_state(state: &PriorProviderState) {
    if let Ok(mut states) = provider_states().lock() {
        states.remove(&state.handle);
    }
}

fn validate_request(request: &AiAgentTurnRequest, provider: Provider) -> Result<(), AgentError> {
    if !bounded_text(&request.model, MAX_MODEL_BYTES)
        || request.model.chars().any(char::is_whitespace)
    {
        return Err(AgentError::new(AgentErrorCode::InvalidModel));
    }
    if !bounded_multiline_text(&request.instructions, MAX_INSTRUCTIONS_BYTES) {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    if request.input.is_empty() || request.input.len() > MAX_INPUT_ITEMS {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    let mut total_input = 0usize;
    for item in &request.input {
        let role_ok = matches!(
            item.role.as_str(),
            "user" | "assistant" | "system" | "developer" | "tool"
        );
        if !role_ok || !bounded_multiline_text(&item.content, MAX_INPUT_ITEM_BYTES) {
            return Err(AgentError::new(AgentErrorCode::InvalidInput));
        }
        if item.role == "tool" {
            let call_id = item
                .call_id
                .as_deref()
                .ok_or_else(|| AgentError::new(AgentErrorCode::InvalidInput))?;
            if !bounded_text(call_id, 512) || request.prior_provider_state.is_none() {
                return Err(AgentError::new(AgentErrorCode::InvalidInput));
            }
            if let Some(name) = item.name.as_deref() {
                if !valid_tool_name(name) {
                    return Err(AgentError::new(AgentErrorCode::InvalidInput));
                }
            }
        } else if item.call_id.is_some() || item.name.is_some() || item.is_error.is_some() {
            return Err(AgentError::new(AgentErrorCode::InvalidInput));
        }
        total_input = total_input.saturating_add(item.content.len());
    }
    if total_input > MAX_TOTAL_INPUT_BYTES {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    if provider == Provider::Anthropic
        && request
            .input
            .iter()
            .any(|item| item.role == "system" || item.role == "developer")
    {
        return Err(AgentError::new(AgentErrorCode::InvalidInput));
    }
    if request.tools.len() > MAX_TOOLS {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    let mut total_schema_bytes = 0usize;
    for tool in &request.tools {
        if !valid_tool_name(&tool.name)
            || tool.description.len() > MAX_TOOL_DESCRIPTION_BYTES
            || tool
                .description
                .chars()
                .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
            || !tool.parameters.is_object()
            || tool.parameters.get("type").and_then(Value::as_str) != Some("object")
        {
            return Err(AgentError::new(AgentErrorCode::InvalidTool));
        }
        let schema_bytes = serde_json::to_vec(&tool.parameters)
            .map_err(|_| AgentError::new(AgentErrorCode::InvalidTool))?;
        if schema_bytes.len() > MAX_TOOL_SCHEMA_BYTES {
            return Err(AgentError::new(AgentErrorCode::InputTooLarge));
        }
        total_schema_bytes = total_schema_bytes.saturating_add(schema_bytes.len());
    }
    if total_schema_bytes > MAX_TOTAL_TOOL_SCHEMA_BYTES {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    if let Some(state) = &request.prior_provider_state {
        if !bounded_text(&state.handle, 160) {
            return Err(AgentError::new(AgentErrorCode::InvalidState));
        }
    }
    Ok(())
}

fn openai_tools(tools: &[CadToolDefinition]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            })
        })
        .collect()
}

fn anthropic_tools(tools: &[CadToolDefinition]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "input_schema": tool.parameters,
            })
        })
        .collect()
}

fn openai_payload(request: &AiAgentTurnRequest, replay: Option<&Value>) -> Value {
    let mut input = replay
        .and_then(|data| data.get("input"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    input.extend(
        request
            .input
            .iter()
            .map(|item| {
                if item.role == "tool" {
                    return json!({
                        "type": "function_call_output",
                        "call_id": item.call_id,
                        "output": item.content,
                    });
                }
                json!({
                    "role": item.role,
                    "content": [{ "type": "input_text", "text": item.content }],
                })
            })
            .collect::<Vec<_>>(),
    );
    json!({
        "model": request.model,
        "instructions": request.instructions,
        "input": input,
        "tools": openai_tools(&request.tools),
        "store": false,
        "parallel_tool_calls": false,
        "max_output_tokens": 4096,
        "include": ["reasoning.encrypted_content"],
    })
}

fn anthropic_payload(request: &AiAgentTurnRequest, replay: Option<&Value>) -> Value {
    let mut messages = replay
        .and_then(|data| data.get("messages"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    messages.extend(
        request
            .input
            .iter()
            .map(|item| {
                if item.role == "tool" {
                    return json!({
                        "role": "user",
                        "content": [{
                            "type": "tool_result",
                            "tool_use_id": item.call_id,
                            "content": item.content,
                            "is_error": item.is_error.unwrap_or(false),
                        }],
                    });
                }
                json!({
                    "role": item.role,
                    "content": [{ "type": "text", "text": item.content }],
                })
            })
            .collect::<Vec<_>>(),
    );
    json!({
        "model": request.model,
        "max_tokens": 4096,
        "system": request.instructions,
        "messages": messages,
        "tools": anthropic_tools(&request.tools),
        "tool_choice": { "type": "auto", "disable_parallel_tool_use": true },
    })
}

fn finish_status(value: Option<&str>, has_tools: bool) -> FinishStatus {
    if has_tools {
        return FinishStatus::ToolCalls;
    }
    match value {
        Some("completed") | Some("end_turn") => FinishStatus::Completed,
        Some("incomplete") | Some("max_tokens") => FinishStatus::Incomplete,
        _ => FinishStatus::Unknown,
    }
}

fn string_field(object: &Map<String, Value>, field: &str) -> Option<String> {
    object.get(field).and_then(Value::as_str).map(str::to_owned)
}

fn parse_arguments(value: &Value) -> Result<Value, AgentError> {
    let raw = value
        .as_str()
        .ok_or_else(|| AgentError::new(AgentErrorCode::InvalidResponse))?;
    if raw.len() > MAX_TOOL_ARGUMENT_BYTES {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    serde_json::from_str(raw).map_err(|_| AgentError::new(AgentErrorCode::InvalidResponse))
}

fn normalize_openai(response: &Value) -> Result<AiAgentTurnResult, AgentError> {
    let object = response
        .as_object()
        .ok_or_else(|| AgentError::new(AgentErrorCode::InvalidResponse))?;
    let output = object
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| AgentError::new(AgentErrorCode::InvalidResponse))?;
    let mut assistant_text = String::new();
    let mut tool_calls = Vec::new();
    for item in output {
        let item_object = match item.as_object() {
            Some(value) => value,
            None => continue,
        };
        match item_object.get("type").and_then(Value::as_str) {
            Some("message") => {
                if let Some(content) = item_object.get("content").and_then(Value::as_array) {
                    for block in content {
                        if block.get("type").and_then(Value::as_str) == Some("output_text") {
                            if let Some(text) = block.get("text").and_then(Value::as_str) {
                                assistant_text.push_str(text);
                            }
                        }
                    }
                }
            }
            Some("function_call") => {
                let call_id = string_field(item_object, "call_id")
                    .or_else(|| string_field(item_object, "id"));
                let name = string_field(item_object, "name");
                let arguments = item_object
                    .get("arguments")
                    .and_then(|value| parse_arguments(value).ok());
                match (call_id, name, arguments) {
                    (Some(call_id), Some(name), Some(arguments)) => {
                        tool_calls.push(NormalizedToolCall {
                            call_id,
                            name,
                            arguments,
                        })
                    }
                    _ => return Err(AgentError::new(AgentErrorCode::InvalidResponse)),
                }
            }
            _ => {}
        }
        if assistant_text.len() > MAX_RESPONSE_TEXT_BYTES {
            return Err(AgentError::new(AgentErrorCode::InputTooLarge));
        }
    }
    let status = object.get("status").and_then(Value::as_str);
    Ok(AiAgentTurnResult {
        assistant_text,
        finish_status: finish_status(status, !tool_calls.is_empty()),
        tool_calls,
        provider_continuation_id: string_field(object, "id"),
        provider_state: None,
    })
}

fn normalize_anthropic(response: &Value) -> Result<AiAgentTurnResult, AgentError> {
    let object = response
        .as_object()
        .ok_or_else(|| AgentError::new(AgentErrorCode::InvalidResponse))?;
    let content = object
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| AgentError::new(AgentErrorCode::InvalidResponse))?;
    let mut assistant_text = String::new();
    let mut tool_calls = Vec::new();
    for block in content {
        let block_object = match block.as_object() {
            Some(value) => value,
            None => continue,
        };
        match block_object.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = block_object.get("text").and_then(Value::as_str) {
                    assistant_text.push_str(text);
                }
            }
            Some("tool_use") => {
                let call_id = string_field(block_object, "id");
                let name = string_field(block_object, "name");
                let arguments = block_object.get("input").cloned();
                match (call_id, name, arguments) {
                    (Some(call_id), Some(name), Some(arguments)) => {
                        let size = serde_json::to_vec(&arguments)
                            .map(|bytes| bytes.len())
                            .unwrap_or(MAX_TOOL_ARGUMENT_BYTES + 1);
                        if size > MAX_TOOL_ARGUMENT_BYTES {
                            return Err(AgentError::new(AgentErrorCode::InputTooLarge));
                        }
                        tool_calls.push(NormalizedToolCall {
                            call_id,
                            name,
                            arguments,
                        });
                    }
                    _ => return Err(AgentError::new(AgentErrorCode::InvalidResponse)),
                }
            }
            _ => {}
        }
    }
    if assistant_text.len() > MAX_RESPONSE_TEXT_BYTES {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    let stop_reason = object.get("stop_reason").and_then(Value::as_str);
    Ok(AiAgentTurnResult {
        assistant_text,
        finish_status: finish_status(stop_reason, !tool_calls.is_empty()),
        tool_calls,
        provider_continuation_id: string_field(object, "id"),
        provider_state: None,
    })
}

fn map_http_status(status: StatusCode) -> AgentError {
    let code = match status {
        StatusCode::UNAUTHORIZED => AgentErrorCode::ProviderUnauthorized,
        StatusCode::FORBIDDEN => AgentErrorCode::ProviderForbidden,
        StatusCode::TOO_MANY_REQUESTS => AgentErrorCode::ProviderRateLimited,
        StatusCode::REQUEST_TIMEOUT => AgentErrorCode::ProviderTimeout,
        _ => AgentErrorCode::ProviderHttp,
    };
    AgentError::new(code)
}

fn validate_returned_tool_calls(
    result: &AiAgentTurnResult,
    tools: &[CadToolDefinition],
) -> Result<(), AgentError> {
    if result.tool_calls.len() > 1 {
        return Err(AgentError::new(AgentErrorCode::InvalidResponse));
    }
    let mut call_ids = std::collections::HashSet::new();
    for call in &result.tool_calls {
        if !tools.iter().any(|tool| tool.name == call.name)
            || !valid_tool_name(&call.name)
            || !bounded_text(&call.call_id, 512)
            || !call.arguments.is_object()
            || !call_ids.insert(call.call_id.as_str())
        {
            return Err(AgentError::new(AgentErrorCode::InvalidResponse));
        }
    }
    Ok(())
}

fn attach_provider_state(
    provider: Provider,
    model: &str,
    payload: &Value,
    response: &Value,
    result: &mut AiAgentTurnResult,
) -> Result<(), AgentError> {
    let (field, mut history) = match provider {
        Provider::Openai => (
            "input",
            payload
                .get("input")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        ),
        Provider::Anthropic => (
            "messages",
            payload
                .get("messages")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        ),
    };
    match provider {
        Provider::Openai => history.extend(
            response
                .get("output")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        ),
        Provider::Anthropic => history.push(json!({
            "role": "assistant",
            "content": response
                .get("content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default(),
        })),
    }
    let data = json!({ (field): history });
    if serde_json::to_vec(&data)
        .map_err(|_| AgentError::new(AgentErrorCode::InvalidResponse))?
        .len()
        > MAX_PRIOR_STATE_BYTES
    {
        return Err(AgentError::new(AgentErrorCode::InputTooLarge));
    }
    result.provider_state = Some(store_provider_state(provider, model, data)?);
    Ok(())
}

/// Executes one bounded provider turn. The function returns normalized data
/// only; provider bodies are parsed and then discarded, never forwarded.
#[tauri::command]
pub async fn ai_agent_turn(request: AiAgentTurnRequest) -> Result<AiAgentTurnResult, AgentError> {
    let provider =
        Provider::parse(&request.provider).map_err(|error| map_credential_error(error.code))?;
    validate_request(&request, provider)?;
    let replay = request
        .prior_provider_state
        .as_ref()
        .map(|state| load_provider_state(state, provider, &request.model))
        .transpose()?;
    let api_key = ai_credentials::load_credential(provider).map_err(map_credential_error)?;
    let payload = match provider {
        Provider::Openai => openai_payload(&request, replay.as_ref()),
        Provider::Anthropic => anthropic_payload(&request, replay.as_ref()),
    };
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AgentError::new(AgentErrorCode::ProviderNetwork))?;
    let endpoint = match provider {
        Provider::Openai => OPENAI_ENDPOINT,
        Provider::Anthropic => ANTHROPIC_ENDPOINT,
    };
    let mut builder = client
        .post(endpoint)
        .header("content-type", "application/json");
    builder = match provider {
        Provider::Openai => builder.bearer_auth(&*api_key),
        Provider::Anthropic => builder
            .header("x-api-key", &*api_key)
            .header("anthropic-version", ANTHROPIC_VERSION),
    };
    let response = builder.json(&payload).send().await.map_err(|error| {
        if error.is_timeout() {
            AgentError::new(AgentErrorCode::ProviderTimeout)
        } else {
            AgentError::new(AgentErrorCode::ProviderNetwork)
        }
    })?;
    drop(api_key);
    if !response.status().is_success() {
        return Err(map_http_status(response.status()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BODY_BYTES as u64)
    {
        return Err(AgentError::new(AgentErrorCode::InvalidResponse));
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|_| AgentError::new(AgentErrorCode::InvalidResponse))?;
    if bytes.len() > MAX_RESPONSE_BODY_BYTES {
        return Err(AgentError::new(AgentErrorCode::InvalidResponse));
    }
    let body: Value = serde_json::from_slice(&bytes)
        .map_err(|_| AgentError::new(AgentErrorCode::InvalidResponse))?;
    let mut result = match provider {
        Provider::Openai => normalize_openai(&body),
        Provider::Anthropic => normalize_anthropic(&body),
    }?;
    validate_returned_tool_calls(&result, &request.tools)?;
    attach_provider_state(provider, &request.model, &payload, &body, &mut result)?;
    if let Some(previous) = &request.prior_provider_state {
        remove_provider_state(previous);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(provider: &str) -> AiAgentTurnRequest {
        AiAgentTurnRequest {
            provider: provider.to_string(),
            model: "model-test".to_string(),
            instructions: "Follow the CAD policy.".to_string(),
            input: vec![AgentInputItem {
                role: "user".to_string(),
                content: "Make a bracket.".to_string(),
                call_id: None,
                name: None,
                is_error: None,
            }],
            tools: vec![CadToolDefinition {
                name: "cad_apply".to_string(),
                description: "Apply bounded CAD changes.".to_string(),
                parameters: json!({"type":"object","properties":{}}),
            }],
            prior_provider_state: None,
        }
    }

    #[test]
    fn openai_payload_uses_non_storing_serial_responses_controls() {
        let payload = openai_payload(&request("openai"), None);
        assert_eq!(payload["store"], false);
        assert_eq!(payload["parallel_tool_calls"], false);
        assert!(payload.get("previous_response_id").is_none());
        assert_eq!(payload["include"][0], "reasoning.encrypted_content");
        assert_eq!(payload["tools"][0]["type"], "function");
        assert!(payload.to_string().contains("cad_apply"));
    }

    #[test]
    fn anthropic_payload_uses_messages_and_input_schema() {
        let payload = anthropic_payload(&request("anthropic"), None);
        assert_eq!(payload["messages"][0]["role"], "user");
        assert_eq!(payload["tools"][0]["input_schema"]["type"], "object");
        assert_eq!(payload["max_tokens"], 4096);
        assert_eq!(payload["tool_choice"]["disable_parallel_tool_use"], true);
    }

    #[test]
    fn openai_normalization_collects_text_and_non_first_function_call() {
        let response = json!({"id":"resp_1","status":"completed","output":[
            {"type":"reasoning","summary":[]},
            {"type":"function_call","call_id":"call_1","name":"cad_apply","arguments":"{\"x\":1}"},
            {"type":"message","content":[{"type":"output_text","text":"Done"}]}
        ]});
        let normalized = normalize_openai(&response).unwrap();
        assert_eq!(normalized.assistant_text, "Done");
        assert_eq!(normalized.tool_calls[0].call_id, "call_1");
        assert_eq!(normalized.tool_calls[0].arguments["x"], 1);
        assert!(matches!(normalized.finish_status, FinishStatus::ToolCalls));
    }

    #[test]
    fn anthropic_normalization_collects_text_and_tool_use_blocks() {
        let response = json!({"id":"msg_1","stop_reason":"tool_use","content":[
            {"type":"text","text":"I will apply it."},
            {"type":"tool_use","id":"tool_1","name":"cad_apply","input":{"x":1}}
        ]});
        let normalized = normalize_anthropic(&response).unwrap();
        assert_eq!(normalized.assistant_text, "I will apply it.");
        assert_eq!(normalized.tool_calls[0].name, "cad_apply");
        assert!(matches!(normalized.finish_status, FinishStatus::ToolCalls));
    }

    #[test]
    fn validation_bounds_models_tools_and_anthropic_roles() {
        let mut oversized = request("openai");
        oversized.model = "x".repeat(MAX_MODEL_BYTES + 1);
        assert_eq!(
            validate_request(&oversized, Provider::Openai)
                .unwrap_err()
                .code,
            AgentErrorCode::InvalidModel
        );
        let mut anthropic = request("anthropic");
        anthropic.input[0].role = "system".to_string();
        assert_eq!(
            validate_request(&anthropic, Provider::Anthropic)
                .unwrap_err()
                .code,
            AgentErrorCode::InvalidInput
        );
    }

    #[test]
    fn stateless_openai_replay_appends_function_output() {
        let mut next = request("openai");
        let state = store_provider_state(Provider::Openai, "model-test", json!({"input":[
                {"role":"user","content":[{"type":"input_text","text":"Make a bracket."}]},
                {"type":"function_call","call_id":"call_1","name":"cad_apply","arguments":"{\"x\":1}"}
            ]})).unwrap();
        next.prior_provider_state = Some(state.clone());
        next.input = vec![AgentInputItem {
            role: "tool".to_string(),
            content: "{\"ok\":true}".to_string(),
            call_id: Some("call_1".to_string()),
            name: Some("cad_apply".to_string()),
            is_error: Some(false),
        }];
        validate_request(&next, Provider::Openai).unwrap();
        let replay = load_provider_state(&state, Provider::Openai, "model-test").unwrap();
        let payload = openai_payload(&next, Some(&replay));
        assert_eq!(payload["input"][2]["type"], "function_call_output");
        assert_eq!(payload["input"][2]["call_id"], "call_1");
        assert!(serde_json::to_value(&state).unwrap().get("data").is_none());
        remove_provider_state(&state);
    }
}
