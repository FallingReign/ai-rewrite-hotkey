use serde::Serialize;
use std::time::Duration;

const COPY_POLL_TIMEOUT: Duration = Duration::from_millis(750);
const COPY_POLL_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMetadata {
    pub target_captured: bool,
    pub clipboard_snapshot_captured: bool,
    pub copy_sent: bool,
    pub clipboard_restored: bool,
    pub selected_text_char_length: Option<usize>,
    pub usable_text_char_length: Option<usize>,
    pub leading_wrapper_length: Option<usize>,
    pub trailing_wrapper_length: Option<usize>,
    pub poll_attempts: u32,
    pub duration_ms: u128,
}

impl CaptureMetadata {
    fn new() -> Self {
        Self {
            target_captured: false,
            clipboard_snapshot_captured: false,
            copy_sent: false,
            clipboard_restored: false,
            selected_text_char_length: None,
            usable_text_char_length: None,
            leading_wrapper_length: None,
            trailing_wrapper_length: None,
            poll_attempts: 0,
            duration_ms: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFinishedPayload {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<&'static str>,
    pub metadata: CaptureMetadata,
}

pub fn capture_selected_text() -> CaptureFinishedPayload {
    platform::capture_selected_text()
}

#[cfg(windows)]
mod platform {
    use super::{CaptureFinishedPayload, CaptureMetadata, COPY_POLL_INTERVAL, COPY_POLL_TIMEOUT};
    use std::{
        ffi::c_void,
        mem::size_of,
        ptr::{copy_nonoverlapping, null_mut},
        slice, thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND},
        System::{
            DataExchange::{
                CloseClipboard, EmptyClipboard, EnumClipboardFormats, GetClipboardData,
                GetClipboardSequenceNumber, OpenClipboard, SetClipboardData,
            },
            Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE},
        },
        UI::{
            Input::KeyboardAndMouse::{
                SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
                KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL,
            },
            WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
        },
    };

    const CF_UNICODETEXT: u32 = 13;
    const VK_C: VIRTUAL_KEY = 0x43;

    struct RewriteTarget {
        _hwnd: HWND,
        _process_id: u32,
    }

    struct ClipboardSnapshot {
        sequence_number: u32,
        previous_plain_text: Option<String>,
        formats: Vec<ClipboardFormatData>,
    }

    struct ClipboardFormatData {
        format: u32,
        handle: HGLOBAL,
    }

    impl Drop for ClipboardFormatData {
        fn drop(&mut self) {
            if !self.handle.is_null() {
                unsafe {
                    GlobalFree(self.handle);
                }
                self.handle = null_mut();
            }
        }
    }

    struct OpenClipboardGuard;

    impl Drop for OpenClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    pub fn capture_selected_text() -> CaptureFinishedPayload {
        let started_at = Instant::now();
        let mut metadata = CaptureMetadata::new();

        if capture_foreground_target().is_err() {
            return failure("rewrite_target_unavailable", metadata, started_at);
        }
        metadata.target_captured = true;

        let snapshot = match capture_clipboard_snapshot() {
            Ok(snapshot) => {
                metadata.clipboard_snapshot_captured = true;
                snapshot
            }
            Err(_) => return failure("clipboard_snapshot_failed", metadata, started_at),
        };

        let mut category = None;
        let mut captured_text_metadata = None;

        thread::sleep(Duration::from_millis(120));

        if send_copy().is_ok() {
            metadata.copy_sent = true;

            match poll_for_selected_text(
                snapshot.sequence_number,
                snapshot.previous_plain_text.as_deref(),
                &mut metadata,
            ) {
                Some(text) => {
                    if let Some(text_metadata) = classify_selected_text(&text) {
                        captured_text_metadata = Some(text_metadata);
                    } else {
                        category = Some("selected_text_empty");
                    }
                }
                None => category = Some("selected_text_empty"),
            }
        } else {
            category = Some("copy_failed");
        }

        match snapshot.restore() {
            Ok(()) => metadata.clipboard_restored = true,
            Err(_) => return failure("clipboard_restore_failed", metadata, started_at),
        }

        if let Some(text_metadata) = captured_text_metadata {
            metadata.selected_text_char_length = Some(text_metadata.selected_text_char_length);
            metadata.usable_text_char_length = Some(text_metadata.usable_text_char_length);
            metadata.leading_wrapper_length = Some(text_metadata.leading_wrapper_length);
            metadata.trailing_wrapper_length = Some(text_metadata.trailing_wrapper_length);
            metadata.duration_ms = started_at.elapsed().as_millis();

            CaptureFinishedPayload {
                ok: true,
                category: None,
                metadata,
            }
        } else {
            failure(category.unwrap_or("unexpected_error"), metadata, started_at)
        }
    }

    fn capture_foreground_target() -> Result<RewriteTarget, ()> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return Err(());
            }

            let mut process_id = 0;
            GetWindowThreadProcessId(hwnd, &mut process_id);

            Ok(RewriteTarget {
                _hwnd: hwnd,
                _process_id: process_id,
            })
        }
    }

    fn capture_clipboard_snapshot() -> Result<ClipboardSnapshot, ()> {
        with_clipboard(|| unsafe {
            let sequence_number = GetClipboardSequenceNumber();
            let mut formats = Vec::new();
            let mut format = 0;

            loop {
                format = EnumClipboardFormats(format);
                if format == 0 {
                    break;
                }

                let handle = GetClipboardData(format);
                if handle.is_null() {
                    return Err(());
                }

                formats.push(ClipboardFormatData {
                    format,
                    handle: duplicate_global_memory(handle)?,
                });
            }

            let previous_plain_text = read_plain_text_from_open_clipboard().ok().flatten();

            Ok(ClipboardSnapshot {
                sequence_number,
                previous_plain_text,
                formats,
            })
        })
    }

    impl ClipboardSnapshot {
        fn restore(mut self) -> Result<(), ()> {
            with_clipboard(|| unsafe {
                if EmptyClipboard() == 0 {
                    return Err(());
                }

                for item in &mut self.formats {
                    let handle = item.handle;
                    if handle.is_null() {
                        return Err(());
                    }

                    if SetClipboardData(item.format, handle as HANDLE).is_null() {
                        return Err(());
                    }

                    item.handle = null_mut();
                }

                Ok(())
            })
        }
    }

    fn duplicate_global_memory(handle: HANDLE) -> Result<HGLOBAL, ()> {
        unsafe {
            let source_handle = handle as HGLOBAL;
            let size = GlobalSize(source_handle);
            if size == 0 {
                return Err(());
            }

            let source = GlobalLock(source_handle);
            if source.is_null() {
                return Err(());
            }

            let duplicate = GlobalAlloc(GMEM_MOVEABLE, size);
            if duplicate.is_null() {
                GlobalUnlock(source_handle);
                return Err(());
            }

            let destination = GlobalLock(duplicate);
            if destination.is_null() {
                GlobalUnlock(source_handle);
                GlobalFree(duplicate);
                return Err(());
            }

            copy_nonoverlapping(source as *const u8, destination as *mut u8, size);
            GlobalUnlock(duplicate);
            GlobalUnlock(source_handle);

            Ok(duplicate)
        }
    }

    fn send_copy() -> Result<(), ()> {
        let inputs = [
            keyboard_input(VK_CONTROL, 0),
            keyboard_input(VK_C, 0),
            keyboard_input(VK_C, KEYEVENTF_KEYUP),
            keyboard_input(VK_CONTROL, KEYEVENTF_KEYUP),
        ];

        unsafe {
            let sent = SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                size_of::<INPUT>() as i32,
            );

            if sent == inputs.len() as u32 {
                Ok(())
            } else {
                Err(())
            }
        }
    }

    fn poll_for_selected_text(
        previous_sequence_number: u32,
        previous_plain_text: Option<&str>,
        metadata: &mut CaptureMetadata,
    ) -> Option<String> {
        let started_at = Instant::now();
        let deadline = started_at + COPY_POLL_TIMEOUT;

        loop {
            metadata.poll_attempts += 1;
            let allow_unchanged_text = started_at.elapsed() >= Duration::from_millis(150);

            if let Ok(Some(text)) = read_plain_text_after_sequence(
                previous_sequence_number,
                previous_plain_text,
                allow_unchanged_text,
            ) {
                return Some(text);
            }

            if Instant::now() >= deadline {
                return None;
            }

            thread::sleep(COPY_POLL_INTERVAL);
        }
    }

    fn read_plain_text_after_sequence(
        previous_sequence_number: u32,
        previous_plain_text: Option<&str>,
        allow_unchanged_text: bool,
    ) -> Result<Option<String>, ()> {
        with_clipboard(|| unsafe {
            let sequence_changed = GetClipboardSequenceNumber() != previous_sequence_number;
            let text = read_plain_text_from_open_clipboard()?;

            if sequence_changed {
                return Ok(text);
            }

            if allow_unchanged_text
                && text.as_deref() == previous_plain_text
                && text.as_deref().is_some_and(|value| !value.is_empty())
            {
                return Ok(text);
            }

            Ok(None)
        })
    }

    unsafe fn read_plain_text_from_open_clipboard() -> Result<Option<String>, ()> {
        let handle = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            return Ok(None);
        }

        let size = GlobalSize(handle as HGLOBAL);
        if size < 2 {
            return Ok(Some(String::new()));
        }

        let locked = GlobalLock(handle as HGLOBAL);
        if locked.is_null() {
            return Ok(None);
        }

        let units = slice::from_raw_parts(locked as *const u16, size / 2);
        let nul_index = units
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(units.len());
        let text = String::from_utf16_lossy(&units[..nul_index]);
        GlobalUnlock(handle as HGLOBAL);

        Ok(Some(text))
    }

    struct ClassifiedTextMetadata {
        selected_text_char_length: usize,
        usable_text_char_length: usize,
        leading_wrapper_length: usize,
        trailing_wrapper_length: usize,
    }

    fn classify_selected_text(text: &str) -> Option<ClassifiedTextMetadata> {
        if text.trim().is_empty() {
            return None;
        }

        let trimmed_start = text.trim_start();
        let leading_bytes = text.len() - trimmed_start.len();
        let trimmed_end = text.trim_end();
        let trailing_bytes = text.len() - trimmed_end.len();
        let usable = &text[leading_bytes..text.len() - trailing_bytes];

        Some(ClassifiedTextMetadata {
            selected_text_char_length: text.chars().count(),
            usable_text_char_length: usable.chars().count(),
            leading_wrapper_length: text[..leading_bytes].chars().count(),
            trailing_wrapper_length: text[text.len() - trailing_bytes..].chars().count(),
        })
    }

    fn keyboard_input(vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    fn with_clipboard<T>(operation: impl FnOnce() -> Result<T, ()>) -> Result<T, ()> {
        unsafe {
            if OpenClipboard(null_mut::<c_void>()) == 0 {
                return Err(());
            }
        }

        let _guard = OpenClipboardGuard;
        operation()
    }

    fn failure(
        category: &'static str,
        mut metadata: CaptureMetadata,
        started_at: Instant,
    ) -> CaptureFinishedPayload {
        metadata.duration_ms = started_at.elapsed().as_millis();

        CaptureFinishedPayload {
            ok: false,
            category: Some(category),
            metadata,
        }
    }
}

#[cfg(not(windows))]
mod platform {
    use super::{CaptureFinishedPayload, CaptureMetadata};

    pub fn capture_selected_text() -> CaptureFinishedPayload {
        CaptureFinishedPayload {
            ok: false,
            category: Some("unexpected_error"),
            metadata: CaptureMetadata::new(),
        }
    }
}
