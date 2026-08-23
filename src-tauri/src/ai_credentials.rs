use serde::{Deserialize, Serialize};
use std::time::Duration;
use zeroize::Zeroizing;

pub const CREDENTIAL_SERVICE: &str = "com.nexysys.nexyfab.ai";
const MAX_API_KEY_BYTES: usize = 4096;
const CONNECTIVITY_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Anthropic,
}

impl Provider {
    pub fn parse(value: &str) -> Result<Self, CommandError> {
        match value {
            "openai" => Ok(Self::Openai),
            "anthropic" => Ok(Self::Anthropic),
            _ => Err(CommandError::new(ErrorCode::InvalidProvider)),
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Openai => "openai",
            Self::Anthropic => "anthropic",
        }
    }

    const fn endpoint(self) -> &'static str {
        match self {
            Self::Openai => "https://api.openai.com/v1/models",
            Self::Anthropic => "https://api.anthropic.com/v1/models",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    InvalidProvider,
    InvalidCredential,
    KeyringUnavailable,
    CredentialMissing,
    CredentialSaveFailed,
    CredentialDeleteFailed,
    ConnectivityUnauthorized,
    ConnectivityForbidden,
    ConnectivityTimeout,
    ConnectivityNetwork,
    ConnectivityHttp,
}

#[derive(Debug, Serialize)]
pub struct CommandError {
    pub code: ErrorCode,
}

impl CommandError {
    pub const fn new(code: ErrorCode) -> Self {
        Self { code }
    }
}

#[derive(Debug, Serialize)]
pub struct ProviderStatus {
    pub provider: &'static str,
    pub has_credential: bool,
}

#[derive(Debug, Serialize)]
pub struct ConnectivityStatus {
    pub provider: &'static str,
    pub ok: bool,
    pub code: &'static str,
}

fn entry(provider: Provider) -> Result<keyring::Entry, CommandError> {
    keyring::Entry::new(CREDENTIAL_SERVICE, provider.as_str())
        .map_err(|_| CommandError::new(ErrorCode::KeyringUnavailable))
}

/// Loads a provider credential for trusted native consumers without exposing
/// it through a command result. The caller must keep the returned value
/// short-lived; `Zeroizing` clears the string when it leaves scope.
pub(crate) fn load_credential(provider: Provider) -> Result<Zeroizing<String>, ErrorCode> {
    let credential = entry(provider).map_err(|_| ErrorCode::KeyringUnavailable)?;
    match credential.get_password() {
        Ok(secret) => Ok(Zeroizing::new(secret)),
        Err(keyring::Error::NoEntry) => Err(ErrorCode::CredentialMissing),
        Err(_) => Err(ErrorCode::KeyringUnavailable),
    }
}

fn status_for(provider: Provider) -> Result<ProviderStatus, CommandError> {
    let credential = entry(provider)?;
    match credential.get_password() {
        Ok(secret) => {
            let _secret = Zeroizing::new(secret);
            Ok(ProviderStatus {
                provider: provider.as_str(),
                has_credential: true,
            })
        }
        Err(keyring::Error::NoEntry) => Ok(ProviderStatus {
            provider: provider.as_str(),
            has_credential: false,
        }),
        Err(_) => Err(CommandError::new(ErrorCode::KeyringUnavailable)),
    }
}

pub fn validate_api_key(api_key: &str) -> Result<(), ErrorCode> {
    if api_key.is_empty()
        || api_key.len() > MAX_API_KEY_BYTES
        || api_key
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err(ErrorCode::InvalidCredential);
    }
    Ok(())
}

#[tauri::command]
pub fn ai_provider_status(provider: String) -> Result<ProviderStatus, CommandError> {
    status_for(Provider::parse(&provider)?)
}

#[tauri::command]
pub fn ai_provider_has_credential(provider: String) -> Result<ProviderStatus, CommandError> {
    ai_provider_status(provider)
}

#[tauri::command]
pub fn ai_provider_save_credential(
    provider: String,
    api_key: String,
) -> Result<ProviderStatus, CommandError> {
    let api_key = Zeroizing::new(api_key);
    let provider = Provider::parse(&provider)?;
    if let Err(code) = validate_api_key(&api_key) {
        return Err(CommandError::new(code));
    }

    let result = entry(provider).and_then(|credential| {
        credential
            .set_password(&api_key)
            .map_err(|_| CommandError::new(ErrorCode::CredentialSaveFailed))
    });
    result?;
    status_for(provider)
}

#[tauri::command]
pub fn ai_provider_delete_credential(provider: String) -> Result<ProviderStatus, CommandError> {
    let provider = Provider::parse(&provider)?;
    let credential = entry(provider)?;
    match credential.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(ProviderStatus {
            provider: provider.as_str(),
            has_credential: false,
        }),
        Err(_) => Err(CommandError::new(ErrorCode::CredentialDeleteFailed)),
    }
}

#[tauri::command]
pub async fn ai_provider_test_connection(
    provider: String,
) -> Result<ConnectivityStatus, CommandError> {
    let provider = Provider::parse(&provider)?;
    let credential = entry(provider)?;
    let api_key = match credential.get_password() {
        Ok(value) => Zeroizing::new(value),
        Err(keyring::Error::NoEntry) => {
            return Err(CommandError::new(ErrorCode::CredentialMissing))
        }
        Err(_) => return Err(CommandError::new(ErrorCode::KeyringUnavailable)),
    };

    let client = reqwest::Client::builder()
        .timeout(CONNECTIVITY_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| CommandError::new(ErrorCode::ConnectivityNetwork))?;
    let mut request = client.get(provider.endpoint());
    request = match provider {
        Provider::Openai => request.bearer_auth(&*api_key),
        Provider::Anthropic => request
            .header("x-api-key", &*api_key)
            .header("anthropic-version", "2023-06-01"),
    };
    let response = request.send().await;
    let response = match response {
        Ok(response) => response,
        Err(error) if error.is_timeout() => {
            return Ok(ConnectivityStatus {
                provider: provider.as_str(),
                ok: false,
                code: "timeout",
            })
        }
        Err(_) => {
            return Ok(ConnectivityStatus {
                provider: provider.as_str(),
                ok: false,
                code: "network_error",
            })
        }
    };
    let status = response.status();
    let code = if status.is_success() {
        "ok"
    } else if status.as_u16() == 401 {
        "unauthorized"
    } else if status.as_u16() == 403 {
        "forbidden"
    } else {
        "http_error"
    };
    Ok(ConnectivityStatus {
        provider: provider.as_str(),
        ok: status.is_success(),
        code,
    })
}

#[cfg(test)]
mod tests {
    use super::{validate_api_key, ErrorCode, Provider};

    #[test]
    fn provider_allowlist_is_exact() {
        assert_eq!(Provider::parse("openai").unwrap(), Provider::Openai);
        assert_eq!(Provider::parse("anthropic").unwrap(), Provider::Anthropic);
        assert_eq!(
            Provider::parse("OpenAI").unwrap_err().code,
            ErrorCode::InvalidProvider
        );
        assert_eq!(
            Provider::parse("google").unwrap_err().code,
            ErrorCode::InvalidProvider
        );
    }

    #[test]
    fn credential_validation_is_bounded_without_vendor_prefix_assumptions() {
        assert!(validate_api_key("generic-credential-without-vendor-prefix").is_ok());
        assert_eq!(
            validate_api_key("").unwrap_err(),
            ErrorCode::InvalidCredential
        );
        assert_eq!(
            validate_api_key("key\nvalue").unwrap_err(),
            ErrorCode::InvalidCredential
        );
        assert_eq!(
            validate_api_key("key value").unwrap_err(),
            ErrorCode::InvalidCredential
        );
        assert_eq!(
            validate_api_key(&"x".repeat(4097)).unwrap_err(),
            ErrorCode::InvalidCredential
        );
    }
}
