use serde_json::Value;
use std::{
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;

mod native_capture;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct HotkeyRuntimeState {
    in_flight_capture: AtomicBool,
    cancel_requested: AtomicBool,
    quit_after_cancel: AtomicBool,
}

enum TauriCliError {
    Failed,
    Cancelled,
}

#[derive(PartialEq, Eq)]
enum HotkeyRegistrationResult {
    Registered,
    NotNeeded,
    Failed,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Released {
                        handle_rewrite_hotkey(app.clone());
                    }
                })
                .build(),
        )
        .manage(HotkeyRuntimeState::default())
        .setup(|app| {
            create_tray(app.handle())?;
            match run_tauri_cli(&["app-started"]) {
                Ok(value) => {
                    let registration = sync_rewrite_hotkey_registration(app.handle(), &value);
                    if registration != HotkeyRegistrationResult::Failed {
                        notify_startup(app.handle(), &value);
                    }
                }
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
    let open_settings =
        MenuItem::with_id(app, "open_settings", "Open Settings", true, None::<&str>)?;
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
                request_quit(app);
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
        "enable" => {
            let response = run_tauri_cli(&["set-enabled", "true"]);
            let registration = if let Ok(value) = &response {
                sync_rewrite_hotkey_registration(&app, value)
            } else {
                HotkeyRegistrationResult::NotNeeded
            };

            if registration != HotkeyRegistrationResult::Failed {
                notify_from_cli_response(
                    &app,
                    response,
                    "Rewrite Hotkey enabled",
                    "The app state was updated.",
                );
            }
        }
        "disable" => {
            app.state::<HotkeyRuntimeState>()
                .cancel_requested
                .store(true, Ordering::SeqCst);
            let response = run_tauri_cli(&["set-enabled", "false"]);
            if let Ok(value) = &response {
                sync_rewrite_hotkey_registration(&app, value);
            }
            notify_from_cli_response(
                &app,
                response,
                "Rewrite Hotkey disabled",
                "No rewrite hotkey or rewrite work will run.",
            );
        }
        "open_settings" => notify_from_cli_response(
            &app,
            run_tauri_cli(&["open-settings"]),
            "Settings opened",
            "Review local settings before enabling Rewrite Hotkey.",
        ),
        "test_rewrite" => {
            notify(
                &app,
                "Test Rewrite started",
                "Using the built-in sample only.",
            );
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

fn handle_rewrite_hotkey(app: AppHandle) {
    let state = app.state::<HotkeyRuntimeState>();
    if state.in_flight_capture.swap(true, Ordering::SeqCst) {
        notify(
            &app,
            "Rewrite already in progress",
            "The current rewrite must finish before another can start.",
        );
        return;
    }
    state.cancel_requested.store(false, Ordering::SeqCst);
    state.quit_after_cancel.store(false, Ordering::SeqCst);
    set_tray_tooltip(&app, "Rewrite Hotkey - Rewriting...");

    thread::spawn(move || {
        let _ = run_tauri_cli(&["replacement-flow-started"]);

        match native_capture::capture_selected_text_for_replacement() {
            native_capture::ReplacementCaptureResult::Captured(capture) => {
                let native_capture::ReplacementCapture {
                    selected_text,
                    session,
                } = capture;

                if cancellation_requested(&app) {
                    let native_payload = session.restore_without_paste();
                    notify_replacement_flow_finished(
                        &app,
                        replacement_flow_finished_payload(
                            "safe_failure",
                            Some("disabled_app".to_string()),
                            None,
                            native_payload,
                            None,
                        ),
                    );
                    finish_hotkey_thread(&app);
                    return;
                }

                let screenshot_context = capture_optional_screenshot_context();

                if cancellation_requested(&app) {
                    let native_payload = session.restore_without_paste();
                    notify_replacement_flow_finished(
                        &app,
                        replacement_flow_finished_payload(
                            "safe_failure",
                            Some("disabled_app".to_string()),
                            None,
                            native_payload,
                            None,
                        ),
                    );
                    finish_hotkey_thread(&app);
                    return;
                }

                match run_tauri_cli_with_rewrite_input(
                    &app,
                    &["replacement-flow-rewrite"],
                    &selected_text,
                    screenshot_context,
                ) {
                    Ok(plan) => finish_replacement_flow_from_plan(&app, plan, session),
                    Err(error) => {
                        let native_payload = session.restore_without_paste();
                        let category = if native_payload.ok {
                            Some(match error {
                                TauriCliError::Cancelled => "disabled_app".to_string(),
                                TauriCliError::Failed => "unexpected_error".to_string(),
                            })
                        } else {
                            native_payload.category.map(str::to_string)
                        };
                        notify_replacement_flow_finished(
                            &app,
                            replacement_flow_finished_payload(
                                "safe_failure",
                                category,
                                None,
                                native_payload,
                                None,
                            ),
                        );
                    }
                }
            }
            native_capture::ReplacementCaptureResult::Failed(native_payload) => {
                let category = native_payload.category.map(str::to_string);
                notify_replacement_flow_finished(
                    &app,
                    replacement_flow_finished_payload(
                        "safe_failure",
                        category,
                        None,
                        native_payload,
                        None,
                    ),
                );
            }
        }

        finish_hotkey_thread(&app);
    });
}

fn request_quit(app: AppHandle) {
    let state = app.state::<HotkeyRuntimeState>();
    state.cancel_requested.store(true, Ordering::SeqCst);

    if state.in_flight_capture.load(Ordering::SeqCst) {
        state.quit_after_cancel.store(true, Ordering::SeqCst);
        notify(
            &app,
            "Rewrite cancellation requested",
            "Rewrite Hotkey will quit after the current rewrite stops safely.",
        );
        return;
    }

    app.exit(0);
}

fn finish_hotkey_thread(app: &AppHandle) {
    let state = app.state::<HotkeyRuntimeState>();
    state.in_flight_capture.store(false, Ordering::SeqCst);
    state.cancel_requested.store(false, Ordering::SeqCst);
    set_tray_tooltip(app, "Rewrite Hotkey");

    if state.quit_after_cancel.swap(false, Ordering::SeqCst) {
        app.exit(0);
    }
}

fn cancellation_requested(app: &AppHandle) -> bool {
    app.state::<HotkeyRuntimeState>()
        .cancel_requested
        .load(Ordering::SeqCst)
}

fn capture_optional_screenshot_context() -> Option<Value> {
    if !screenshot_context_enabled() {
        return None;
    }

    Some(match native_capture::capture_screenshot_context() {
        Ok(image) => serde_json::to_value(image).unwrap_or_else(|_| {
            serde_json::json!({
                "ok": false,
                "category": "screenshot_processing_failed"
            })
        }),
        Err(category) => serde_json::json!({
            "ok": false,
            "category": category
        }),
    })
}

fn sync_rewrite_hotkey_registration(app: &AppHandle, value: &Value) -> HotkeyRegistrationResult {
    let _ = app.global_shortcut().unregister_all();

    if !hotkey_registration_allowed(value) {
        return HotkeyRegistrationResult::NotNeeded;
    }

    let Some(hotkey) = load_configured_hotkey() else {
        notify_hotkey_registration_finished(app, false, "hotkey_invalid");
        return HotkeyRegistrationResult::Failed;
    };

    match app.global_shortcut().register(hotkey.as_str()) {
        Ok(()) => {
            notify_hotkey_registration_finished(app, true, "");
            HotkeyRegistrationResult::Registered
        }
        Err(_) => {
            notify_hotkey_registration_finished(app, false, "hotkey_registration_conflict");
            HotkeyRegistrationResult::Failed
        }
    }
}

fn hotkey_registration_allowed(value: &Value) -> bool {
    value
        .get("state")
        .and_then(|state| state.get("hotkeyRegistrationAllowed"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn notify_hotkey_registration_finished(app: &AppHandle, ok: bool, category: &str) {
    let payload = if ok {
        serde_json::json!({ "ok": true })
    } else {
        serde_json::json!({ "ok": false, "category": category })
    };
    let payload_json = payload.to_string();
    let response = run_tauri_cli(&["hotkey-registration-finished", payload_json.as_str()]);

    if !ok {
        notify_from_cli_response(
            app,
            response,
            "Rewrite Hotkey conflict",
            "The configured hotkey could not be registered. The app will keep running.",
        );
    }
}

fn finish_replacement_flow_from_plan(
    app: &AppHandle,
    plan: Value,
    session: native_capture::ReplacementSession,
) {
    let provider_status_class = plan
        .get("providerStatusClass")
        .and_then(Value::as_str)
        .map(str::to_string);

    match plan.get("action").and_then(Value::as_str) {
        Some("paste") => {
            let Some(paste_text) = plan.get("pasteText").and_then(Value::as_str) else {
                let native_payload = session.restore_without_paste();
                let category = if native_payload.ok {
                    Some("unexpected_error".to_string())
                } else {
                    native_payload.category.map(str::to_string)
                };
                notify_replacement_flow_finished(
                    app,
                    replacement_flow_finished_payload(
                        "safe_failure",
                        category,
                        provider_status_class,
                        native_payload,
                        Some(&plan),
                    ),
                );
                return;
            };

            let native_payload = session.paste_replacement_and_restore(paste_text);
            let outcome = if native_payload.ok {
                "succeeded"
            } else {
                "safe_failure"
            };
            let category = native_payload.category.map(str::to_string);
            notify_replacement_flow_finished(
                app,
                replacement_flow_finished_payload(
                    outcome,
                    category,
                    provider_status_class,
                    native_payload,
                    Some(&plan),
                ),
            );
        }
        Some("noop") => {
            let native_payload = session.restore_without_paste();
            let (outcome, category) = if native_payload.ok {
                ("noop", None)
            } else {
                ("safe_failure", native_payload.category.map(str::to_string))
            };
            notify_replacement_flow_finished(
                app,
                replacement_flow_finished_payload(
                    outcome,
                    category,
                    provider_status_class,
                    native_payload,
                    Some(&plan),
                ),
            );
        }
        Some("restore") => {
            let plan_category = plan
                .get("category")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| Some("unexpected_error".to_string()));
            let native_payload = session.restore_without_paste();
            let category = if native_payload.ok {
                plan_category
            } else {
                native_payload.category.map(str::to_string)
            };
            notify_replacement_flow_finished(
                app,
                replacement_flow_finished_payload(
                    "safe_failure",
                    category,
                    provider_status_class,
                    native_payload,
                    Some(&plan),
                ),
            );
        }
        _ => {
            let native_payload = session.restore_without_paste();
            let category = if native_payload.ok {
                Some("unexpected_error".to_string())
            } else {
                native_payload.category.map(str::to_string)
            };
            notify_replacement_flow_finished(
                app,
                replacement_flow_finished_payload(
                    "safe_failure",
                    category,
                    provider_status_class,
                    native_payload,
                    Some(&plan),
                ),
            );
        }
    }
}

fn replacement_flow_finished_payload(
    outcome: &str,
    category: Option<String>,
    provider_status_class: Option<String>,
    native_payload: native_capture::CaptureFinishedPayload,
    plan: Option<&Value>,
) -> Value {
    let mut metadata =
        serde_json::to_value(native_payload.metadata).unwrap_or_else(|_| serde_json::json!({}));

    if let (Some(metadata_object), Some(plan_metadata)) = (
        metadata.as_object_mut(),
        plan.and_then(|value| value.get("metadata"))
            .and_then(Value::as_object),
    ) {
        for key in [
            "replacementTextCharLength",
            "pasteTextCharLength",
            "screenshotContextEnabled",
            "screenshotContextCaptured",
            "screenshotContextIncluded",
            "screenshotContextDegraded",
            "screenshotContextDegradationCategory",
            "screenshotPayloadSizeClass",
        ] {
            if let Some(value) = plan_metadata.get(key) {
                metadata_object.insert(key.to_string(), value.clone());
            }
        }
    }

    serde_json::json!({
        "ok": outcome != "safe_failure",
        "outcome": outcome,
        "category": category,
        "providerStatusClass": provider_status_class,
        "metadata": metadata
    })
}

fn notify_replacement_flow_finished(app: &AppHandle, payload: Value) {
    let silent_success = payload
        .get("outcome")
        .and_then(Value::as_str)
        .is_some_and(|outcome| outcome == "succeeded");
    let payload_json = payload.to_string();
    let response = run_tauri_cli(&["replacement-flow-finished", payload_json.as_str()]);

    let degraded_success = payload
        .get("metadata")
        .and_then(Value::as_object)
        .and_then(|metadata| metadata.get("screenshotContextDegraded"))
        .and_then(Value::as_bool)
        .unwrap_or(false);

    if silent_success && !degraded_success {
        return;
    }

    notify_from_cli_response(
        app,
        response,
        "Rewrite failed safely",
        "The Replacement Flow stopped before paste. Original selection and clipboard were restored where possible.",
    );
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

fn run_tauri_cli_with_rewrite_input(
    app: &AppHandle,
    args: &[&str],
    selected_text: &str,
    screenshot_context: Option<Value>,
) -> Result<Value, TauriCliError> {
    let input = serde_json::json!({
        "selectedText": selected_text,
        "screenshotContext": screenshot_context
    });
    let stdin_text = input.to_string();
    let mut command = Command::new(npm_command());
    command
        .current_dir(project_root())
        .arg("run")
        .arg("--silent")
        .arg("app:tauri")
        .arg("--")
        .args(args)
        .env("REWRITE_HOTKEY_PRIVATE_PIPE", "1")
        .env("REWRITE_HOTKEY_PRIVATE_PIPE_FORMAT", "json")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command.spawn().map_err(|_| TauriCliError::Failed)?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(stdin_text.as_bytes())
            .map_err(|_| TauriCliError::Failed)?;
    }
    drop(child.stdin.take());

    loop {
        if cancellation_requested(app) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(TauriCliError::Cancelled);
        }

        match child.try_wait().map_err(|_| TauriCliError::Failed)? {
            Some(_) => break,
            None => thread::sleep(Duration::from_millis(50)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|_| TauriCliError::Failed)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    serde_json::from_str(stdout.trim()).map_err(|_| TauriCliError::Failed)
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

fn load_configured_hotkey() -> Option<String> {
    let raw = std::fs::read_to_string(config_path()).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let hotkey = value.get("hotkey").and_then(Value::as_str)?.trim();

    if hotkey.is_empty() {
        None
    } else {
        Some(hotkey.to_string())
    }
}

fn screenshot_context_enabled() -> bool {
    let raw = match std::fs::read_to_string(config_path()) {
        Ok(raw) => raw,
        Err(_) => return true,
    };
    let value: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return true,
    };

    value
        .get("screenshotContextEnabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

fn config_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .map(|home| home.join("AppData").join("Roaming"))
        })
        .unwrap_or_else(|| PathBuf::from("."));

    base.join("Rewrite Hotkey").join("config.json")
}

fn notify_from_cli_response(
    app: &AppHandle,
    value: Result<Value, ()>,
    fallback_title: &str,
    fallback_body: &str,
) {
    match value {
        Ok(value) => {
            if value
                .get("silent")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                return;
            }

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
        notify(
            app,
            "Rewrite Hotkey disabled",
            "No rewrite hotkey or rewrite work will run.",
        );
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
    let _ = app.notification().builder().title(title).body(body).show();
}

fn set_tray_tooltip(app: &AppHandle, tooltip: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
