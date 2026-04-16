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
    let mut files: Vec<String> = if list_path.exists() {
        let content = std::fs::read_to_string(&list_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        vec![]
    };
    files.retain(|f| f != &path);
    files.insert(0, path);
    files.truncate(10); // 최근 10개만 유지
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
        ])
        .run(tauri::generate_context!())
        .expect("NexyFab 실행 오류");
}
