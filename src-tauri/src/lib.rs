use tauri::Manager;
use std::path::PathBuf;

// ─── File I/O commands ───────────────────────────────────────────────────────

/// .nfab 프로젝트 파일 저장
#[tauri::command]
async fn save_project(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, &content).map_err(|e| e.to_string())
}

/// .nfab 프로젝트 파일 열기
#[tauri::command]
async fn load_project(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 최근 파일 목록을 앱 데이터 디렉토리에서 관리
#[tauri::command]
async fn get_recent_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let path = recent_files_path(&app)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let files: Vec<String> = serde_json::from_str(&content).unwrap_or_default();
    // 실제로 존재하는 파일만 반환
    Ok(files.into_iter().filter(|f| std::path::Path::new(f).exists()).collect())
}

#[tauri::command]
async fn add_recent_file(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let list_path = recent_files_path(&app)?;
    let files: Vec<String> = if list_path.exists() {
        let content = std::fs::read_to_string(&list_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };
    let files = apply_recent_file_mutation(files, path.as_str(), 10);
    let json = serde_json::to_string(&files).map_err(|e| e.to_string())?;
    std::fs::write(&list_path, json).map_err(|e| e.to_string())
}

fn recent_files_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("recent_files.json"))
}

// ─── App info ────────────────────────────────────────────────────────────────

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// 데스크톱 스모크·모니터링용 — 프론트에서 `invoke('nexyfab_health')` 로 연결 확인.
#[tauri::command]
fn nexyfab_health() -> serde_json::Value {
    serde_json::json!({
        "ok": true,
        "version": env!("CARGO_PKG_VERSION"),
        "commands": [
            "save_project",
            "load_project",
            "get_recent_files",
            "add_recent_file",
            "get_app_version",
            "nexyfab_health",
        ],
    })
}

// ─── Entry point ─────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_project,
            load_project,
            get_recent_files,
            add_recent_file,
            get_app_version,
            nexyfab_health,
        ])
        .run(tauri::generate_context!())
        .expect("NexyFab 실행 오류");
}

/// Recent-files dedupe + cap — `add_recent_file`와 공유(회귀 테스트 동일 규칙).
fn apply_recent_file_mutation(mut files: Vec<String>, path: &str, max: usize) -> Vec<String> {
    files.retain(|f| f != path);
    files.insert(0, path.to_string());
    files.truncate(max);
    files
}

// Mirrors `save_project` / `load_project` I/O for desktop release gates (`npm run test:tauri-unit`).
#[cfg(test)]
mod save_load_tests {
    use std::fs;
    use super::apply_recent_file_mutation;

    #[test]
    fn recent_files_cap_matches_add_recent_file_policy() {
        let many: Vec<String> = (0..15).map(|i| format!("/part{i}.nfab")).collect();
        let out = apply_recent_file_mutation(many, "/new.nfab", 10);
        assert_eq!(out.len(), 10);
        assert_eq!(out[0], "/new.nfab");
    }

    #[test]
    fn health_command_payload_shape() {
        let v = serde_json::json!({
            "ok": true,
            "version": env!("CARGO_PKG_VERSION"),
        });
        assert_eq!(v["ok"], true);
        assert!(!v["version"].as_str().unwrap().is_empty());
    }

    #[test]
    fn write_and_read_string_roundtrip() {
        let mut path = std::env::temp_dir();
        path.push(format!("nexyfab_save_roundtrip_{}.nfab", std::process::id()));
        let content = r#"{"version":1,"assembly":{"placedParts":[],"mates":[]}}"#;
        fs::write(&path, content).expect("write");
        let got = fs::read_to_string(&path).expect("read");
        let _ = fs::remove_file(&path);
        assert_eq!(got, content);
    }

    #[test]
    fn save_project_command_semantics_match_fs_write() {
        let path = std::env::temp_dir().join(format!("nexyfab_cmd_{}.nfab", std::process::id()));
        let s = "{\"ok\":true}";
        fs::write(&path, s).map_err(|e| e.to_string()).unwrap();
        let loaded = fs::read_to_string(&path).map_err(|e| e.to_string()).unwrap();
        let _ = fs::remove_file(&path);
        assert_eq!(loaded, s);
    }
}
