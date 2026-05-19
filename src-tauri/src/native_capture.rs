use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType, DynamicImage, RgbImage};
use serde::Serialize;
use std::{
    thread,
    time::{Duration, Instant},
};

const COPY_POLL_TIMEOUT: Duration = Duration::from_millis(750);
const COPY_POLL_INTERVAL: Duration = Duration::from_millis(50);
const PRE_COPY_SETTLE_DELAY: Duration = Duration::from_millis(120);
const PASTE_RESTORE_DELAY: Duration = Duration::from_millis(500);
const SCREENSHOT_CONTEXT_MAX_LONG_EDGE: u32 = 1280;
const SCREENSHOT_CONTEXT_IMAGE_MAX_BYTES: usize = 512 * 1024;
const SCREENSHOT_CONTEXT_JPEG_QUALITIES: [u8; 4] = [72, 60, 50, 42];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureMetadata {
    pub target_captured: bool,
    pub clipboard_snapshot_captured: bool,
    pub copy_sent: bool,
    pub paste_sent: bool,
    pub clipboard_restored: bool,
    pub selected_text_char_length: Option<usize>,
    pub usable_text_char_length: Option<usize>,
    pub leading_wrapper_length: Option<usize>,
    pub trailing_wrapper_length: Option<usize>,
    pub replacement_text_char_length: Option<usize>,
    pub paste_text_char_length: Option<usize>,
    pub poll_attempts: u32,
    pub duration_ms: u128,
}

impl CaptureMetadata {
    fn new() -> Self {
        Self {
            target_captured: false,
            clipboard_snapshot_captured: false,
            copy_sent: false,
            paste_sent: false,
            clipboard_restored: false,
            selected_text_char_length: None,
            usable_text_char_length: None,
            leading_wrapper_length: None,
            trailing_wrapper_length: None,
            replacement_text_char_length: None,
            paste_text_char_length: None,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotContextImage {
    pub ok: bool,
    pub media_type: &'static str,
    pub base64: String,
    pub byte_length: usize,
    pub width: u32,
    pub height: u32,
}

pub enum ReplacementCaptureResult {
    Captured(ReplacementCapture),
    Failed(CaptureFinishedPayload),
}

pub struct ReplacementCapture {
    pub selected_text: String,
    pub session: ReplacementSession,
}

pub struct ReplacementSession {
    target: platform::RewriteTarget,
    snapshot: platform::ClipboardSnapshot,
    metadata: CaptureMetadata,
    started_at: Instant,
}

struct ScreenshotBitmap {
    width: u32,
    height: u32,
    rgb: Vec<u8>,
}

impl ReplacementSession {
    pub fn restore_without_paste(self) -> CaptureFinishedPayload {
        let mut metadata = self.metadata;

        match self.snapshot.restore() {
            Ok(()) => {
                metadata.clipboard_restored = true;
                success(metadata, self.started_at)
            }
            Err(_) => failure("clipboard_restore_failed", metadata, self.started_at),
        }
    }

    pub fn paste_replacement_and_restore(self, paste_text: &str) -> CaptureFinishedPayload {
        let mut metadata = self.metadata;
        metadata.paste_text_char_length = Some(paste_text.chars().count());

        let category = if !platform::is_foreground_target(&self.target).unwrap_or(false) {
            Some("rewrite_target_changed")
        } else if platform::set_clipboard_plain_text(paste_text).is_err() {
            Some("clipboard_write_failed")
        } else if platform::send_paste().is_err() {
            Some("paste_failed")
        } else {
            metadata.paste_sent = true;
            thread::sleep(PASTE_RESTORE_DELAY);
            None
        };

        match self.snapshot.restore() {
            Ok(()) => metadata.clipboard_restored = true,
            Err(_) => return failure("clipboard_restore_failed", metadata, self.started_at),
        }

        match category {
            Some(category) => failure(category, metadata, self.started_at),
            None => success(metadata, self.started_at),
        }
    }
}

#[allow(dead_code)]
pub fn capture_selected_text() -> CaptureFinishedPayload {
    match capture_selected_text_for_replacement() {
        ReplacementCaptureResult::Captured(capture) => capture.session.restore_without_paste(),
        ReplacementCaptureResult::Failed(payload) => payload,
    }
}

pub fn capture_selected_text_for_replacement() -> ReplacementCaptureResult {
    let started_at = Instant::now();
    let mut metadata = CaptureMetadata::new();

    let target = match platform::capture_foreground_target() {
        Ok(target) => target,
        Err(_) => {
            return ReplacementCaptureResult::Failed(failure(
                "rewrite_target_unavailable",
                metadata,
                started_at,
            ))
        }
    };
    metadata.target_captured = true;

    let snapshot = match platform::capture_clipboard_snapshot() {
        Ok(snapshot) => {
            metadata.clipboard_snapshot_captured = true;
            snapshot
        }
        Err(_) => {
            return ReplacementCaptureResult::Failed(failure(
                "clipboard_snapshot_failed",
                metadata,
                started_at,
            ))
        }
    };

    thread::sleep(PRE_COPY_SETTLE_DELAY);

    if platform::send_copy().is_err() {
        return ReplacementCaptureResult::Failed(restore_then_failure(
            snapshot,
            metadata,
            "copy_failed",
            started_at,
        ));
    }
    metadata.copy_sent = true;

    let selected_text = match platform::poll_for_selected_text(&snapshot, &mut metadata) {
        Some(text) => text,
        None => {
            return ReplacementCaptureResult::Failed(restore_then_failure(
                snapshot,
                metadata,
                "selected_text_empty",
                started_at,
            ))
        }
    };

    let text_metadata = match classify_selected_text(&selected_text) {
        Some(text_metadata) => text_metadata,
        None => {
            return ReplacementCaptureResult::Failed(restore_then_failure(
                snapshot,
                metadata,
                "selected_text_empty",
                started_at,
            ))
        }
    };

    metadata.selected_text_char_length = Some(text_metadata.selected_text_char_length);
    metadata.usable_text_char_length = Some(text_metadata.usable_text_char_length);
    metadata.leading_wrapper_length = Some(text_metadata.leading_wrapper_length);
    metadata.trailing_wrapper_length = Some(text_metadata.trailing_wrapper_length);

    ReplacementCaptureResult::Captured(ReplacementCapture {
        selected_text,
        session: ReplacementSession {
            target,
            snapshot,
            metadata,
            started_at,
        },
    })
}

pub fn capture_screenshot_context() -> Result<ScreenshotContextImage, &'static str> {
    let bitmap = platform::capture_full_screen_bitmap().map_err(|_| "screenshot_capture_failed")?;
    encode_screenshot_context(bitmap).map_err(|_| "screenshot_processing_failed")
}

fn encode_screenshot_context(bitmap: ScreenshotBitmap) -> Result<ScreenshotContextImage, ()> {
    let image = RgbImage::from_raw(bitmap.width, bitmap.height, bitmap.rgb).ok_or(())?;
    let mut image = DynamicImage::ImageRgb8(image);
    image = resize_to_long_edge(image, SCREENSHOT_CONTEXT_MAX_LONG_EDGE);

    let mut encoded = Vec::new();
    for (index, quality) in SCREENSHOT_CONTEXT_JPEG_QUALITIES.iter().enumerate() {
        encoded.clear();
        {
            let mut encoder = JpegEncoder::new_with_quality(&mut encoded, *quality);
            encoder.encode_image(&image).map_err(|_| ())?;
        }

        if encoded.len() <= SCREENSHOT_CONTEXT_IMAGE_MAX_BYTES
            || index == SCREENSHOT_CONTEXT_JPEG_QUALITIES.len() - 1
        {
            break;
        }

        let next_long_edge = ((image.width().max(image.height()) as f32) * 0.82) as u32;
        image = resize_to_long_edge(image, next_long_edge);
    }

    let width = image.width();
    let height = image.height();
    let bytes = encoded;

    Ok(ScreenshotContextImage {
        ok: true,
        media_type: "image/jpeg",
        base64: BASE64_STANDARD.encode(&bytes),
        byte_length: bytes.len(),
        width,
        height,
    })
}

fn resize_to_long_edge(image: DynamicImage, max_long_edge: u32) -> DynamicImage {
    let long_edge = image.width().max(image.height());
    if long_edge <= max_long_edge || max_long_edge == 0 {
        return image;
    }

    let scale = max_long_edge as f32 / long_edge as f32;
    let width = ((image.width() as f32) * scale).max(1.0).round() as u32;
    let height = ((image.height() as f32) * scale).max(1.0).round() as u32;
    image.resize(width, height, FilterType::Triangle)
}

fn restore_then_failure(
    snapshot: platform::ClipboardSnapshot,
    mut metadata: CaptureMetadata,
    category: &'static str,
    started_at: Instant,
) -> CaptureFinishedPayload {
    match snapshot.restore() {
        Ok(()) => {
            metadata.clipboard_restored = true;
            failure(category, metadata, started_at)
        }
        Err(_) => failure("clipboard_restore_failed", metadata, started_at),
    }
}

fn success(mut metadata: CaptureMetadata, started_at: Instant) -> CaptureFinishedPayload {
    metadata.duration_ms = started_at.elapsed().as_millis();

    CaptureFinishedPayload {
        ok: true,
        category: None,
        metadata,
    }
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

#[cfg(windows)]
mod platform {
    use super::{CaptureMetadata, ScreenshotBitmap, COPY_POLL_INTERVAL, COPY_POLL_TIMEOUT};
    use std::{
        ffi::c_void,
        mem::{size_of, zeroed},
        ptr::{copy_nonoverlapping, null_mut},
        slice, thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND},
        Graphics::Gdi::{
            BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC,
            GetDIBits, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB,
            DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, SRCCOPY,
        },
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
            WindowsAndMessaging::{
                GetForegroundWindow, GetSystemMetrics, GetWindowThreadProcessId,
                SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
            },
        },
    };

    const CF_UNICODETEXT: u32 = 13;
    const VK_C: VIRTUAL_KEY = 0x43;
    const VK_V: VIRTUAL_KEY = 0x56;

    pub(super) struct RewriteTarget {
        hwnd: HWND,
        process_id: u32,
    }

    pub(super) struct ClipboardSnapshot {
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

    pub(super) fn capture_foreground_target() -> Result<RewriteTarget, ()> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return Err(());
            }

            let mut process_id = 0;
            GetWindowThreadProcessId(hwnd, &mut process_id);

            Ok(RewriteTarget { hwnd, process_id })
        }
    }

    pub(super) fn is_foreground_target(target: &RewriteTarget) -> Result<bool, ()> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return Err(());
            }

            let mut process_id = 0;
            GetWindowThreadProcessId(hwnd, &mut process_id);

            Ok(hwnd == target.hwnd && process_id == target.process_id)
        }
    }

    pub(super) fn capture_clipboard_snapshot() -> Result<ClipboardSnapshot, ()> {
        with_clipboard(|| unsafe {
            let sequence_number = GetClipboardSequenceNumber();
            let previous_plain_text = read_plain_text_from_open_clipboard().ok().flatten();
            let mut formats = Vec::new();
            let mut format = 0;
            let mut had_formats = false;

            loop {
                format = EnumClipboardFormats(format);
                if format == 0 {
                    break;
                }
                had_formats = true;

                let handle = GetClipboardData(format);
                if handle.is_null() {
                    continue;
                }

                if let Ok(handle) = duplicate_global_memory(handle) {
                    formats.push(ClipboardFormatData { format, handle });
                }
            }

            if had_formats && formats.is_empty() && previous_plain_text.is_none() {
                return Err(());
            }

            Ok(ClipboardSnapshot {
                sequence_number,
                previous_plain_text,
                formats,
            })
        })
    }

    impl ClipboardSnapshot {
        pub(super) fn restore(mut self) -> Result<(), ()> {
            with_clipboard(|| unsafe {
                if EmptyClipboard() == 0 {
                    return Err(());
                }

                let mut restored_unicode_text = false;
                for item in &mut self.formats {
                    let handle = item.handle;
                    if handle.is_null() {
                        return Err(());
                    }

                    if SetClipboardData(item.format, handle as HANDLE).is_null() {
                        return Err(());
                    }

                    item.handle = null_mut();
                    if item.format == CF_UNICODETEXT {
                        restored_unicode_text = true;
                    }
                }

                if !restored_unicode_text {
                    if let Some(text) = self.previous_plain_text.as_deref() {
                        set_open_clipboard_plain_text(text)?;
                    }
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

    pub(super) fn send_copy() -> Result<(), ()> {
        send_control_shortcut(VK_C)
    }

    pub(super) fn send_paste() -> Result<(), ()> {
        send_control_shortcut(VK_V)
    }

    pub(super) fn set_clipboard_plain_text(text: &str) -> Result<(), ()> {
        with_clipboard(|| unsafe {
            if EmptyClipboard() == 0 {
                return Err(());
            }

            set_open_clipboard_plain_text(text)
        })
    }

    unsafe fn set_open_clipboard_plain_text(text: &str) -> Result<(), ()> {
        let handle = unicode_text_handle(text)?;

        if SetClipboardData(CF_UNICODETEXT, handle as HANDLE).is_null() {
            GlobalFree(handle);
            return Err(());
        }

        Ok(())
    }

    fn unicode_text_handle(text: &str) -> Result<HGLOBAL, ()> {
        let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
        let size = wide.len() * size_of::<u16>();

        unsafe {
            let handle = GlobalAlloc(GMEM_MOVEABLE, size);
            if handle.is_null() {
                return Err(());
            }

            let destination = GlobalLock(handle);
            if destination.is_null() {
                GlobalFree(handle);
                return Err(());
            }

            copy_nonoverlapping(wide.as_ptr() as *const u8, destination as *mut u8, size);
            GlobalUnlock(handle);

            Ok(handle)
        }
    }

    pub(super) fn poll_for_selected_text(
        snapshot: &ClipboardSnapshot,
        metadata: &mut CaptureMetadata,
    ) -> Option<String> {
        let started_at = Instant::now();
        let deadline = started_at + COPY_POLL_TIMEOUT;

        loop {
            metadata.poll_attempts += 1;
            let allow_unchanged_text = started_at.elapsed() >= Duration::from_millis(150);

            if let Ok(Some(text)) = read_plain_text_after_sequence(
                snapshot.sequence_number,
                snapshot.previous_plain_text.as_deref(),
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

    pub(super) fn capture_full_screen_bitmap() -> Result<ScreenshotBitmap, ()> {
        unsafe {
            let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

            if width <= 0 || height <= 0 {
                return Err(());
            }

            let screen_dc = GetDC(null_mut());
            if screen_dc.is_null() {
                return Err(());
            }

            let result = capture_from_screen_dc(screen_dc, x, y, width, height);
            ReleaseDC(null_mut(), screen_dc);
            result
        }
    }

    unsafe fn capture_from_screen_dc(
        screen_dc: HDC,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
    ) -> Result<ScreenshotBitmap, ()> {
        let memory_dc = CreateCompatibleDC(screen_dc);
        if memory_dc.is_null() {
            return Err(());
        }

        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.is_null() {
            DeleteDC(memory_dc);
            return Err(());
        }

        let old_object = SelectObject(memory_dc, bitmap as HGDIOBJ);
        if old_object.is_null() {
            DeleteObject(bitmap as HGDIOBJ);
            DeleteDC(memory_dc);
            return Err(());
        }

        let capture_result =
            if BitBlt(memory_dc, 0, 0, width, height, screen_dc, x, y, SRCCOPY) == 0 {
                Err(())
            } else {
                read_bitmap_pixels(memory_dc, bitmap, width, height)
            };

        SelectObject(memory_dc, old_object);
        DeleteObject(bitmap as HGDIOBJ);
        DeleteDC(memory_dc);

        capture_result
    }

    unsafe fn read_bitmap_pixels(
        memory_dc: HDC,
        bitmap: HBITMAP,
        width: i32,
        height: i32,
    ) -> Result<ScreenshotBitmap, ()> {
        let mut bitmap_info: BITMAPINFO = zeroed();
        bitmap_info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..zeroed()
        };

        let pixel_count = (width as usize).checked_mul(height as usize).ok_or(())?;
        let mut bgra = vec![0_u8; pixel_count.checked_mul(4).ok_or(())?];

        let rows = GetDIBits(
            memory_dc,
            bitmap,
            0,
            height as u32,
            bgra.as_mut_ptr() as *mut c_void,
            &mut bitmap_info,
            DIB_RGB_COLORS,
        );

        if rows == 0 {
            return Err(());
        }

        let mut rgb = Vec::with_capacity(pixel_count.checked_mul(3).ok_or(())?);
        for pixel in bgra.chunks_exact(4) {
            rgb.push(pixel[2]);
            rgb.push(pixel[1]);
            rgb.push(pixel[0]);
        }

        Ok(ScreenshotBitmap {
            width: width as u32,
            height: height as u32,
            rgb,
        })
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

    fn send_control_shortcut(key: VIRTUAL_KEY) -> Result<(), ()> {
        let inputs = [
            keyboard_input(VK_CONTROL, 0),
            keyboard_input(key, 0),
            keyboard_input(key, KEYEVENTF_KEYUP),
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
}

#[cfg(not(windows))]
mod platform {
    use super::{CaptureMetadata, ScreenshotBitmap};

    pub(super) struct RewriteTarget;
    pub(super) struct ClipboardSnapshot;

    impl ClipboardSnapshot {
        pub(super) fn restore(self) -> Result<(), ()> {
            Err(())
        }
    }

    pub(super) fn capture_foreground_target() -> Result<RewriteTarget, ()> {
        Err(())
    }

    pub(super) fn is_foreground_target(_target: &RewriteTarget) -> Result<bool, ()> {
        Err(())
    }

    pub(super) fn capture_clipboard_snapshot() -> Result<ClipboardSnapshot, ()> {
        Err(())
    }

    pub(super) fn send_copy() -> Result<(), ()> {
        Err(())
    }

    pub(super) fn send_paste() -> Result<(), ()> {
        Err(())
    }

    pub(super) fn set_clipboard_plain_text(_text: &str) -> Result<(), ()> {
        Err(())
    }

    pub(super) fn poll_for_selected_text(
        _snapshot: &ClipboardSnapshot,
        _metadata: &mut CaptureMetadata,
    ) -> Option<String> {
        None
    }

    pub(super) fn capture_full_screen_bitmap() -> Result<ScreenshotBitmap, ()> {
        Err(())
    }
}
