//! Narrow Tauri bridge for the installer-core MCP sidecar.
//!
//! Commands in this module expose only the reviewed installer-core profile.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

const PROFILE: &str = "installer-core";
const MAX_ARGS_BYTES: usize = 256 * 1024;
const MAX_OUTPUT_BYTES: usize = 512 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);
const TOOLS: &[&str] = &[
    "list_domains",
    "build_assembly",
    "analyze_dfm",
    "fab_estimate",
    "resolve_constraints",
    "render_preview",
    "blade_ring",
    "loft_part",
];

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AgentToolResult {
    pub ok: bool,
    pub tool: String,
    pub scope: String,
    pub profile: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AgentToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
    pub scope: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct AgentRuntimeError {
    pub code: &'static str,
}

fn error(code: &'static str) -> AgentRuntimeError {
    AgentRuntimeError { code }
}

fn normalized_error(tool: &str, scope: &str, code: &'static str) -> AgentToolResult {
    AgentToolResult {
        ok: false,
        tool: tool.to_string(),
        scope: scope.to_string(),
        profile: PROFILE.to_string(),
        result: None,
        error_code: Some(code.to_string()),
    }
}

pub fn installer_tool_allowed(tool: &str) -> bool {
    TOOLS.contains(&tool)
}

fn installer_tool_scope(tool: &str) -> Option<&'static str> {
    match tool {
        "list_domains" | "analyze_dfm" => Some("read"),
        "fab_estimate" | "resolve_constraints" | "render_preview" => Some("propose"),
        "build_assembly" | "blade_ring" | "loft_part" => Some("apply"),
        _ => None,
    }
}

fn canonical_tool_scope(tool: &str, args: &Value) -> Option<&'static str> {
    if tool == "render_preview"
        && args
            .get("outDir")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
    {
        return Some("export");
    }
    installer_tool_scope(tool)
}

fn validated_tool_scope(
    tool: &str,
    args: &Value,
    requested: Option<&str>,
    approved: bool,
) -> Result<String, AgentRuntimeError> {
    let canonical = canonical_tool_scope(tool, args).ok_or_else(|| error("invalid_tool"))?;
    if requested.is_some_and(|scope| scope != canonical) {
        return Err(error("scope_mismatch"));
    }
    validate_scope(Some(canonical), approved)
}

fn approval_copy(locale: Option<&str>, tool: &str) -> (String, String, String, String) {
    match locale.unwrap_or("en").split('-').next().unwrap_or("en") {
        "ko" => ("정밀 CAD 변경 승인".into(), format!("'{tool}' 도구가 프로젝트 파일을 변경하거나 내보내려고 합니다. 계속할까요?"), "승인".into(), "취소".into()),
        "ja" => ("精密CAD変更の承認".into(), format!("ツール「{tool}」がプロジェクトファイルを変更または書き出そうとしています。続行しますか？"), "承認".into(), "キャンセル".into()),
        "zh" => ("批准精密 CAD 更改".into(), format!("工具“{tool}”将修改或导出项目文件。是否继续？"), "批准".into(), "取消".into()),
        "es" => ("Aprobar cambio de CAD de precisión".into(), format!("La herramienta '{tool}' modificará o exportará archivos del proyecto. ¿Continuar?"), "Aprobar".into(), "Cancelar".into()),
        "ar" => ("الموافقة على تغيير CAD الدقيق".into(), format!("ستقوم الأداة '{tool}' بتعديل ملفات المشروع أو تصديرها. هل تريد المتابعة؟"), "موافقة".into(), "إلغاء".into()),
        _ => ("Approve precision CAD change".into(), format!("The '{tool}' tool will modify or export project files. Continue?"), "Approve".into(), "Cancel".into()),
    }
}

pub fn validate_scope(scope: Option<&str>, approved: bool) -> Result<String, AgentRuntimeError> {
    let value = scope.unwrap_or("read");
    if !matches!(value, "read" | "propose" | "apply" | "export") {
        return Err(error("invalid_scope"));
    }
    if matches!(value, "apply" | "export") && !approved {
        return Err(error("approval_required"));
    }
    Ok(value.to_string())
}

pub fn validate_arguments(args: &Value) -> Result<(), AgentRuntimeError> {
    if !args.is_object() {
        return Err(error("invalid_arguments"));
    }
    let bytes = serde_json::to_vec(args).map_err(|_| error("invalid_arguments"))?;
    if bytes.len() > MAX_ARGS_BYTES {
        return Err(error("arguments_too_large"));
    }
    Ok(())
}

pub fn canonical_project_root(input: &str) -> Result<PathBuf, AgentRuntimeError> {
    if input.trim().is_empty() || input.chars().any(|c| c.is_control()) {
        return Err(error("project_root_invalid"));
    }
    let path = Path::new(input);
    let canonical = path
        .canonicalize()
        .map_err(|_| error("project_root_missing"))?;
    if !canonical.is_dir() {
        return Err(error("project_root_not_directory"));
    }
    Ok(canonical)
}

/// The fixed filename is the only executable this bridge will ever launch.
/// Tauri installs the external binary beside the app executable.
pub fn sidecar_path_from_exe(exe: &Path) -> Option<PathBuf> {
    Some(exe.parent()?.join(if cfg!(target_os = "windows") {
        "nexyfab-agent-gateway.exe"
    } else {
        "nexyfab-agent-gateway"
    }))
}

fn parse_gateway_output(tool: &str, scope: &str, bytes: &[u8]) -> AgentToolResult {
    if bytes.len() > MAX_OUTPUT_BYTES {
        return normalized_error(tool, scope, "sidecar_output_too_large");
    }
    let text = match std::str::from_utf8(bytes) {
        Ok(value) => value,
        Err(_) => return normalized_error(tool, scope, "sidecar_output_invalid"),
    };
    let mut initialized = false;
    let mut call: Option<Value> = None;
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let value: Value = match serde_json::from_str(line) {
            Ok(value) => value,
            Err(_) => return normalized_error(tool, scope, "sidecar_output_invalid"),
        };
        if value.get("id") == Some(&json!(1)) {
            if value.get("error").is_some() {
                return normalized_error(tool, scope, "gateway_error");
            }
            initialized = value.get("result").is_some();
        } else if value.get("id") == Some(&json!(2)) {
            call = Some(value);
        } else {
            return normalized_error(tool, scope, "sidecar_output_invalid");
        }
    }
    if !initialized {
        return normalized_error(tool, scope, "sidecar_initialize_failed");
    }
    let call = match call {
        Some(value) => value,
        None => return normalized_error(tool, scope, "sidecar_output_invalid"),
    };
    if call.get("error").is_some() {
        return normalized_error(tool, scope, "gateway_error");
    }
    let result = call.get("result").cloned().unwrap_or(Value::Null);
    let is_error = result
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let payload = result
        .get("content")
        .and_then(Value::as_array)
        .and_then(|items| items.first())
        .and_then(|item| item.get("text"))
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .unwrap_or(result);
    AgentToolResult {
        ok: !is_error && payload.get("ok").and_then(Value::as_bool).unwrap_or(true),
        tool: tool.to_string(),
        scope: scope.to_string(),
        profile: PROFILE.to_string(),
        result: Some(payload),
        error_code: if is_error {
            Some("tool_error".to_string())
        } else {
            None
        },
    }
}

fn run_gateway_requests(
    root: &Path,
    scope: &str,
    requests: &[Value],
) -> Result<Vec<u8>, AgentRuntimeError> {
    let exe = std::env::current_exe().map_err(|_| error("sidecar_missing"))?;
    let sidecar = sidecar_path_from_exe(&exe).ok_or_else(|| error("sidecar_missing"))?;
    if !sidecar.is_file() {
        return Err(error("sidecar_missing"));
    }
    let mut command = Command::new(&sidecar);
    command
        .env_clear()
        .env("NEXYFAB_AGENT_RUNTIME_PROFILE", PROFILE)
        .env("NEXYFAB_AGENT_SCOPE", scope)
        .env("NEXYFAB_PROJECT_ROOT", root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| error("sidecar_spawn_failed"))?;
    let input = requests
        .iter()
        .map(|request| serde_json::to_string(request).map(|line| format!("{line}\n")))
        .collect::<Result<String, _>>()
        .map_err(|_| error("sidecar_io_failed"))?;
    let write_result = child
        .stdin
        .take()
        .ok_or_else(|| error("sidecar_io_failed"))
        .and_then(|mut stdin| {
            stdin
                .write_all(input.as_bytes())
                .map_err(|_| error("sidecar_io_failed"))
        });
    if let Err(write_error) = write_result {
        let _ = child.kill();
        let _ = child.wait();
        return Err(write_error);
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| error("sidecar_io_failed"))?;
    let reader = thread::spawn(move || {
        let mut out = Vec::new();
        let mut chunk = [0u8; 8192];
        let mut stream = stdout;
        loop {
            let n = stream.read(&mut chunk).map_err(|_| "sidecar_io_failed")?;
            if n == 0 {
                break;
            }
            out.extend_from_slice(&chunk[..n]);
            if out.len() > MAX_OUTPUT_BYTES {
                return Err("sidecar_output_too_large");
            }
        }
        Ok(out)
    });
    let deadline = Instant::now() + TIMEOUT;
    loop {
        if child
            .try_wait()
            .map_err(|_| error("sidecar_io_failed"))?
            .is_some()
        {
            break;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error("sidecar_timeout"));
        }
        thread::sleep(Duration::from_millis(10));
    }
    reader
        .join()
        .map_err(|_| error("sidecar_io_failed"))?
        .map_err(error)
}

fn agent_tool_call_blocking(
    tool: String,
    args: Value,
    project_root: String,
    scope: Option<String>,
    approved: Option<bool>,
) -> Result<AgentToolResult, AgentRuntimeError> {
    if !installer_tool_allowed(&tool) {
        return Ok(normalized_error(
            &tool,
            scope.as_deref().unwrap_or("read"),
            "invalid_tool",
        ));
    }
    validate_arguments(&args)?;
    let scope = validated_tool_scope(&tool, &args, scope.as_deref(), approved.unwrap_or(false))?;
    let root = canonical_project_root(&project_root)?;
    let initialize = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}});
    let call = json!({"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":tool,"arguments":args}});
    let bytes = run_gateway_requests(&root, &scope, &[initialize, call])?;
    Ok(parse_gateway_output(&tool, &scope, &bytes))
}

/// Runs the blocking sidecar process off Tauri's async command thread.
#[tauri::command]
pub async fn agent_tool_call(
    app: tauri::AppHandle,
    tool: String,
    args: Value,
    project_root: String,
    scope: Option<String>,
    approved: Option<bool>,
    locale: Option<String>,
) -> Result<AgentToolResult, AgentRuntimeError> {
    tauri::async_runtime::spawn_blocking(move || {
        validate_arguments(&args)?;
        let canonical = canonical_tool_scope(&tool, &args).ok_or_else(|| error("invalid_tool"))?;
        if scope
            .as_deref()
            .is_some_and(|requested| requested != canonical)
        {
            return Err(error("scope_mismatch"));
        }
        if matches!(canonical, "apply" | "export") {
            if !approved.unwrap_or(false) {
                return Err(error("approval_required"));
            }
            let (title, message, approve_label, cancel_label) =
                approval_copy(locale.as_deref(), &tool);
            let confirmed = app
                .dialog()
                .message(message)
                .title(title)
                .kind(MessageDialogKind::Warning)
                .buttons(MessageDialogButtons::OkCancelCustom(
                    approve_label,
                    cancel_label,
                ))
                .blocking_show();
            if !confirmed {
                return Err(error("approval_denied"));
            }
        }
        agent_tool_call_blocking(tool, args, project_root, scope, approved)
    })
    .await
    .map_err(|_| error("sidecar_runtime_failed"))?
}

fn parse_tool_catalog(bytes: &[u8]) -> Result<Vec<AgentToolDefinition>, AgentRuntimeError> {
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(error("sidecar_output_too_large"));
    }
    let mut initialized = false;
    let mut listed: Option<Vec<Value>> = None;
    for line in std::str::from_utf8(bytes)
        .map_err(|_| error("sidecar_output_invalid"))?
        .lines()
        .filter(|line| !line.trim().is_empty())
    {
        let value: Value =
            serde_json::from_str(line).map_err(|_| error("sidecar_output_invalid"))?;
        if value.get("id") == Some(&json!(1)) {
            if value.get("error").is_some() {
                return Err(error("gateway_error"));
            }
            initialized = value.get("result").is_some();
        } else if value.get("id") == Some(&json!(2)) {
            if value.get("error").is_some() {
                return Err(error("gateway_error"));
            }
            let tools = value
                .get("result")
                .and_then(|result| result.get("tools"))
                .and_then(Value::as_array)
                .ok_or_else(|| error("sidecar_output_invalid"))?;
            listed = Some(tools.clone());
        } else {
            return Err(error("sidecar_output_invalid"));
        }
    }
    if !initialized {
        return Err(error("sidecar_initialize_failed"));
    }
    let listed = listed.ok_or_else(|| error("sidecar_output_invalid"))?;
    if listed.len() != TOOLS.len() {
        return Err(error("gateway_tool_catalog_mismatch"));
    }
    let mut normalized = Vec::with_capacity(TOOLS.len());
    for expected in TOOLS {
        let item = listed
            .iter()
            .find(|item| item.get("name").and_then(Value::as_str) == Some(*expected))
            .ok_or_else(|| error("gateway_tool_catalog_mismatch"))?;
        let description = item
            .get("description")
            .and_then(Value::as_str)
            .ok_or_else(|| error("sidecar_output_invalid"))?;
        let parameters = item
            .get("inputSchema")
            .cloned()
            .ok_or_else(|| error("sidecar_output_invalid"))?;
        if !parameters.is_object()
            || parameters.get("type").and_then(Value::as_str) != Some("object")
        {
            return Err(error("sidecar_output_invalid"));
        }
        normalized.push(AgentToolDefinition {
            name: (*expected).to_string(),
            description: description.to_string(),
            parameters,
            scope: installer_tool_scope(expected)
                .ok_or_else(|| error("gateway_tool_catalog_mismatch"))?
                .to_string(),
        });
    }
    Ok(normalized)
}

/// Discover the installed installer-core catalog without invoking a tool.
#[tauri::command]
pub async fn agent_tool_catalog(
    project_root: String,
) -> Result<Vec<AgentToolDefinition>, AgentRuntimeError> {
    let root = canonical_project_root(&project_root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let initialize = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}});
        let list = json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}});
        let bytes = run_gateway_requests(&root, "export", &[initialize, list])?;
        parse_tool_catalog(&bytes)
    })
    .await
    .map_err(|_| error("sidecar_runtime_failed"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn exact_installer_allowlist() {
        assert!(installer_tool_allowed("list_domains"));
        assert!(installer_tool_allowed("loft_part"));
        assert!(!installer_tool_allowed("verify_3d"));
        assert!(!installer_tool_allowed("spawn"));
    }
    #[test]
    fn scope_and_approval_are_fail_closed() {
        assert_eq!(validate_scope(None, false).unwrap(), "read");
        assert!(validate_scope(Some("wat"), false).is_err());
        assert_eq!(
            validate_scope(Some("apply"), false).unwrap_err().code,
            "approval_required"
        );
        assert!(validate_scope(Some("export"), true).is_ok());
        assert_eq!(
            validated_tool_scope("build_assembly", &json!({}), Some("read"), true)
                .unwrap_err()
                .code,
            "scope_mismatch"
        );
        assert_eq!(
            validated_tool_scope(
                "render_preview",
                &json!({"outDir":"C:/tmp"}),
                Some("export"),
                true,
            )
            .unwrap(),
            "export"
        );
    }
    #[test]
    fn project_root_is_canonical_directory() {
        let root =
            std::env::temp_dir().join(format!("nexyfab-agent-runtime-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        assert!(canonical_project_root(root.to_str().unwrap()).is_ok());
        assert!(canonical_project_root(root.join("missing").to_str().unwrap()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn parses_initialize_and_tool_fixture_without_secrets() {
        let fixture = "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"{\\\"ok\\\":true,\\\"value\\\":3}\"}]}}\n";
        let result = parse_gateway_output("list_domains", "read", fixture.as_bytes());
        assert!(result.ok);
        assert_eq!(result.result.unwrap()["value"], 3);
    }

    #[test]
    fn normalizes_exact_catalog_and_stable_scopes() {
        let fixture = format!(
            "{{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{{}}}}\n{{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{{\"tools\":[{}]}}}}\n",
            TOOLS.iter().rev().map(|name| format!("{{\"name\":\"{name}\",\"description\":\"local\",\"inputSchema\":{{\"type\":\"object\"}}}}")).collect::<Vec<_>>().join(",")
        );
        let catalog = parse_tool_catalog(fixture.as_bytes()).unwrap();
        assert_eq!(catalog.len(), 8);
        assert_eq!(catalog[0].name, "list_domains");
        assert_eq!(catalog[0].scope, "read");
        assert_eq!(
            catalog
                .iter()
                .find(|tool| tool.name == "render_preview")
                .unwrap()
                .scope,
            "propose"
        );
        assert_eq!(
            catalog
                .iter()
                .find(|tool| tool.name == "build_assembly")
                .unwrap()
                .scope,
            "apply"
        );
    }

    #[test]
    fn rejects_extra_or_non_object_catalog_schema() {
        let fixture = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"unexpected\",\"description\":\"x\",\"inputSchema\":{}}]}}\n";
        assert_eq!(
            parse_tool_catalog(fixture).unwrap_err().code,
            "gateway_tool_catalog_mismatch"
        );
    }
}
