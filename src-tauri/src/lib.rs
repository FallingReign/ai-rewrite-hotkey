use serde_json::Value;
use std::{
    path::PathBuf,
    process::{Command, Stdio},
    thread,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle,
};
use tauri_plugin_notification::NotificationExt;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            create_tray(app.handle())?;
            match run_tauri_cli(&["app-started"]) {
                Ok(value) => notify_startup(app.handle(), &value),
                Err(_) => notify(
                    app.handle(),
                    "Rewrite Hotkey started",
                    "Tray shell is running, but app state could not be checked.",
                ),
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Rewrite Hotkey");
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let enable = MenuItem::with_id(app, "enable", "Enable Rewrite Hotkey", true, None::<&str>)?;
    let disable = MenuItem::with_id(app, "disable", "Disable Rewrite Hotkey", true, None::<&str>)?;
    let open_settings = MenuItem::with_id(app, "open_settings", "Open Settings", true, None::<&str>)?;
    let test_rewrite = MenuItem::with_id(app, "test_rewrite", "Test Rewrite", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &enable,
            &disable,
            &separator_one,
            &open_settings,
            &test_rewrite,
            &separator_two,
            &quit,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id("main")
        .tooltip("Rewrite Hotkey")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_owned();
            let app = app.clone();

            if id == "quit" {
                app.exit(0);
                return;
            }

            thread::spawn(move || handle_menu_action(app, id));
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}

fn handle_menu_action(app: AppHandle, id: String) {
    match id.as_str() {
        "enable" => notify_from_cli_response(
            &app,
            run_tauri_cli(&["set-enabled", "true"]),
            "Rewrite Hotkey enabled",
            "The app state was updated.",
        ),
        "disable" => notify_from_cli_response(
            &app,
            run_tauri_cli(&["set-enabled", "false"]),
            "Rewrite Hotkey disabled",
            "No rewrite hotkey or rewrite work will run.",
        ),
        "open_settings" => notify_from_cli_response(
            &app,
            run_tauri_cli(&["open-settings"]),
            "Settings opened",
            "Review local settings before enabling Rewrite Hotkey.",
        ),
        "test_rewrite" => {
            notify(&app, "Test Rewrite started", "Using the built-in sample only.");
            notify_from_cli_response(
                &app,
                run_tauri_cli(&["test-rewrite"]),
                "Test Rewrite failed safely",
                "The result could not be read. No private rewrite content was shown.",
            );
        }
        _ => notify(
            &app,
            "Rewrite Hotkey action failed",
            "The requested tray action is not available.",
        ),
    }
}

fn run_tauri_cli(args: &[&str]) -> Result<Value, ()> {
    let mut command = Command::new(npm_command());
    command
        .current_dir(project_root())
        .arg("run")
        .arg("--silent")
        .arg("app:tauri")
        .arg("--")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let output = command.output().map_err(|_| ())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|_| ())
}

fn npm_command() -> &'static str {
    if cfg!(windows) {
        "npm.cmd"
    } else {
        "npm"
    }
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri must have a parent project directory")
        .to_path_buf()
}

fn notify_from_cli_response(app: &AppHandle, value: Result<Value, ()>, fallback_title: &str, fallback_body: &str) {
    match value {
        Ok(value) => {
            let notification = value.get("outcome").unwrap_or(&value);
            let title = notification
                .get("notificationTitle")
                .and_then(Value::as_str)
                .unwrap_or(fallback_title);
            let body = notification
                .get("notificationBody")
                .and_then(Value::as_str)
                .unwrap_or(fallback_body);
            notify(app, title, body);
        }
        Err(_) => notify(app, fallback_title, fallback_body),
    }
}

fn notify_startup(app: &AppHandle, value: &Value) {
    let state = value.get("state");
    let enabled = state
        .and_then(|state| state.get("enabled"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let configured = state
        .and_then(|state| state.get("configured"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if !enabled {
        notify(app, "Rewrite Hotkey disabled", "No rewrite hotkey or rewrite work will run.");
    } else if configured {
        notify(app, "Rewrite Hotkey ready", "The tray shell is running.");
    } else {
        notify(
            app,
            "Rewrite Hotkey settings required",
            "Open Settings before using Rewrite Hotkey.",
        );
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show();
}
