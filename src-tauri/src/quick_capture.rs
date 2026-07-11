use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut};

use crate::ensure_main_window;
use crate::main_window_state::main_window_startup_pending;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, POINT, WPARAM},
    System::LibraryLoader::GetModuleHandleW,
    UI::{
        Input::KeyboardAndMouse::{GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON},
        WindowsAndMessaging::{
            CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, KBDLLHOOKSTRUCT, MSG,
            SetWindowsHookExW, TranslateMessage, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
        },
    },
};

pub(crate) const QUICK_CAPTURE_HOTZONE_LABEL: &str = "quick-capture-hotzone";
pub(crate) const QUICK_CAPTURE_PANEL_LABEL: &str = "quick-capture-panel";
const QUICK_CAPTURE_HOT_WIDTH: u32 = 560;
const QUICK_CAPTURE_HOT_HEIGHT: u32 = 10;
const QUICK_CAPTURE_PANEL_WIDTH: u32 = 680;
const QUICK_CAPTURE_PANEL_HEIGHT: u32 = 220;
const QUICK_CAPTURE_EDGE_MARGIN: f64 = 24.0;
const QUICK_CAPTURE_DETACHED_TOP_THRESHOLD: f64 = 48.0;
const QUICK_CAPTURE_READY_TIMEOUT_MS: u64 = 1_500;
const QUICK_CAPTURE_MAX_OPEN_FAILURES: u8 = 2;
const HOTZONE_HOVER_DELAY_MS: u64 = 240;
const QUICK_CAPTURE_HOTZONE_POLL_INTERVAL_MS: u64 = 80;
const QUICK_CAPTURE_ESCAPE_FALLBACK_MS: u64 = 620;

static QUICK_CAPTURE_PAUSED: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_MONITOR: OnceLock<Mutex<Option<QuickCaptureMonitor>>> = OnceLock::new();
static QUICK_CAPTURE_ANCHOR: OnceLock<Mutex<QuickCaptureAnchor>> = OnceLock::new();
static QUICK_CAPTURE_STATE: OnceLock<Mutex<QuickCaptureState>> = OnceLock::new();
static QUICK_CAPTURE_READY_WINDOWS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_FAILURES: OnceLock<Mutex<u8>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_FAILURES: OnceLock<Mutex<u8>> = OnceLock::new();
static QUICK_CAPTURE_DEGRADED_NOTICE_SENT: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_DEGRADED: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_DEGRADED_REASON: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_OPEN_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_READY_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_SAVING_TOKEN: OnceLock<Mutex<Option<u64>>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_OPEN_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_READY_TOKEN: OnceLock<Mutex<u64>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_WATCHING: OnceLock<Mutex<Option<u64>>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_REOPEN_BLOCKED: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_OPENING: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_RECOVERING: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_RECOVERING_SINCE: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();
static QUICK_CAPTURE_SHORTCUT_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static QUICK_CAPTURE_DESTROY_RECONCILE_SUPPRESSIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static QUICK_CAPTURE_ESCAPE_REGISTERED: OnceLock<Mutex<bool>> = OnceLock::new();
static QUICK_CAPTURE_ESCAPE_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static QUICK_CAPTURE_PANEL_SOFT_RETRIES: OnceLock<Mutex<BTreeMap<u64, u8>>> = OnceLock::new();
static QUICK_CAPTURE_HOTZONE_SOFT_RETRIES: OnceLock<Mutex<BTreeMap<u64, u8>>> = OnceLock::new();
static QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_HOOK_STARTED: OnceLock<()> = OnceLock::new();
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_POLL_STARTED: OnceLock<()> = OnceLock::new();
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_HOOK_ARMED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum QuickCaptureState {
    MainVisible,
    HotzoneVisible,
    PanelOpen,
    PanelDetached,
    Paused,
    Degraded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuickCaptureAnchor {
    Left,
    Center,
    Right,
}

impl QuickCaptureAnchor {
    fn as_str(self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Center => "center",
            Self::Right => "right",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickCaptureRuntimeState {
    state: &'static str,
    anchor: &'static str,
    panel_token: u64,
    hotzone_token: u64,
    paused: bool,
    degraded: bool,
    degraded_reason: Option<String>,
    shortcut_available: bool,
    shortcut_error: Option<String>,
    escape_available: bool,
    escape_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QuickCaptureDragResult {
    applied: bool,
    still_dragging: bool,
    detached: bool,
    anchor: &'static str,
    pointer_outside: bool,
}

struct QuickCapturePanelOpenGuard;

impl Drop for QuickCapturePanelOpenGuard {
    fn drop(&mut self) {
        *panel_opening_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
    }
}

impl QuickCaptureState {
    fn as_str(self) -> &'static str {
        match self {
            QuickCaptureState::MainVisible => "MainVisible",
            QuickCaptureState::HotzoneVisible => "HotzoneVisible",
            QuickCaptureState::PanelOpen => "PanelOpen",
            QuickCaptureState::PanelDetached => "PanelDetached",
            QuickCaptureState::Paused => "Paused",
            QuickCaptureState::Degraded => "Degraded",
        }
    }
}

fn ensure_quick_capture_panel_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == QUICK_CAPTURE_PANEL_LABEL {
        Ok(())
    } else {
        Err("This quick capture action must run from the panel window.".into())
    }
}

fn ensure_quick_capture_hotzone_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == QUICK_CAPTURE_HOTZONE_LABEL {
        Ok(())
    } else {
        Err("This quick capture action must run from the hotzone window.".into())
    }
}

fn ensure_quick_capture_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == QUICK_CAPTURE_PANEL_LABEL || window.label() == QUICK_CAPTURE_HOTZONE_LABEL {
        Ok(())
    } else {
        Err("This action must run from a quick capture window.".into())
    }
}

#[derive(Debug, Clone, Copy)]
struct QuickCaptureMonitor {
    logical_x: f64,
    logical_y: f64,
    logical_width: f64,
    physical_x: f64,
    physical_y: f64,
    physical_width: f64,
    scale_factor: f64,
}

impl QuickCaptureMonitor {
    fn from_monitor(monitor: &tauri::Monitor) -> Self {
        let position = monitor.position();
        let size = monitor.size();
        let scale = monitor.scale_factor().max(1.0);
        Self {
            logical_x: position.x as f64 / scale,
            logical_y: position.y as f64 / scale,
            logical_width: size.width as f64 / scale,
            physical_x: position.x as f64,
            physical_y: position.y as f64,
            physical_width: size.width as f64,
            scale_factor: scale,
        }
    }
}

pub(crate) fn quick_capture_paused() -> bool {
    *QUICK_CAPTURE_PAUSED
        .get_or_init(|| Mutex::new(false))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_quick_capture_paused(paused: bool) {
    *QUICK_CAPTURE_PAUSED
        .get_or_init(|| Mutex::new(false))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = paused;
}

fn quick_capture_state_store() -> &'static Mutex<QuickCaptureState> {
    QUICK_CAPTURE_STATE.get_or_init(|| Mutex::new(QuickCaptureState::MainVisible))
}

pub(crate) fn run_quick_capture_on_main<F>(app: &AppHandle, task: F) -> bool
where
    F: FnOnce(AppHandle) + Send + 'static,
{
    let app_for_run = app.clone();
    let app_for_task = app.clone();
    app_for_run
        .run_on_main_thread(move || {
            task(app_for_task);
        })
        .is_ok()
}

pub(crate) fn dispatch_quick_capture_on_main<F>(app: &AppHandle, task: F)
where
    F: FnOnce(AppHandle) + Send + 'static,
{
    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(12));
        let _ = run_quick_capture_on_main(&app_handle, task);
    });
}

fn panel_opening_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_PANEL_OPENING.get_or_init(|| Mutex::new(false))
}

fn escape_registered_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_ESCAPE_REGISTERED.get_or_init(|| Mutex::new(false))
}

fn escape_error_store() -> &'static Mutex<Option<String>> {
    QUICK_CAPTURE_ESCAPE_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_quick_capture_escape_error(message: Option<String>) {
    *escape_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = message;
}

fn quick_capture_escape_error() -> Option<String> {
    escape_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub(crate) fn quick_capture_escape_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

fn register_quick_capture_escape(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        QUICK_CAPTURE_ESCAPE_HOOK_ARMED.store(true, Ordering::SeqCst);
        start_quick_capture_escape_poll(app.clone());
        start_quick_capture_escape_hook(app.clone());
    }

    let mut registered = escape_registered_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *registered {
        return;
    }
    match app
        .global_shortcut()
        .register(quick_capture_escape_shortcut())
    {
        Ok(_) => {
            *registered = true;
            set_quick_capture_escape_error(None);
        }
        Err(error) => {
            set_quick_capture_escape_error(Some(error.to_string()));
        }
    }
}

fn unregister_quick_capture_escape(app: &AppHandle) {
    #[cfg(target_os = "windows")]
    {
        QUICK_CAPTURE_ESCAPE_HOOK_ARMED.store(false, Ordering::SeqCst);
        QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.store(false, Ordering::SeqCst);
    }

    let mut registered = escape_registered_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !*registered {
        return;
    }
    let _ = app
        .global_shortcut()
        .unregister(quick_capture_escape_shortcut());
    *registered = false;
    set_quick_capture_escape_error(None);
}

pub(crate) fn close_quick_capture_panel_from_escape(app_handle: &AppHandle) {
    if !quick_capture_panel_is_active() {
        return;
    }

    let Some(token) = current_panel_token_option() else {
        return;
    };

    if panel_is_saving(token) {
        return;
    }

    if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
        let _ = panel.emit("quick-capture:collapse-request", token);
        let fallback_app = app_handle.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(QUICK_CAPTURE_ESCAPE_FALLBACK_MS));
            run_quick_capture_on_main(&fallback_app, move |app| {
                if current_panel_open_token() != token
                    || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                    || !quick_capture_window_visible(&app, QUICK_CAPTURE_PANEL_LABEL)
                    || panel_is_saving(token)
                {
                    return;
                }

                if quick_capture_state() == QuickCaptureState::PanelDetached {
                    let _ = return_quick_capture_to_hotzone_impl(&app, Some(token));
                } else {
                    let _ = hide_quick_capture_panel_impl(&app, Some(token));
                }
            });
        });
        return;
    }

    if quick_capture_state() == QuickCaptureState::PanelDetached {
        let _ = return_quick_capture_to_hotzone_impl(app_handle, Some(token));
    } else {
        let _ = hide_quick_capture_panel_impl(app_handle, Some(token));
    }
}

#[cfg(target_os = "windows")]
fn start_quick_capture_escape_poll(app: AppHandle) {
    if QUICK_CAPTURE_ESCAPE_POLL_STARTED.set(()).is_err() {
        return;
    }

    thread::spawn(move || {
        let mut was_down = false;
        loop {
            thread::sleep(Duration::from_millis(28));
            if !QUICK_CAPTURE_ESCAPE_HOOK_ARMED.load(Ordering::SeqCst)
                || !quick_capture_panel_is_active()
            {
                was_down = false;
                continue;
            }

            let is_down = unsafe { (GetAsyncKeyState(VK_ESCAPE as i32) as u16 & 0x8000) != 0 };
            if is_down && !was_down {
                let app_for_escape = app.clone();
                run_quick_capture_on_main(&app_for_escape, move |app_handle| {
                    close_quick_capture_panel_from_escape(&app_handle);
                });
            }
            was_down = is_down;
        }
    });
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn quick_capture_keyboard_hook(
    code: i32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if code >= 0
        && QUICK_CAPTURE_ESCAPE_HOOK_ARMED.load(Ordering::SeqCst)
        && (wparam as u32 == WM_KEYDOWN || wparam as u32 == WM_SYSKEYDOWN)
    {
        let event = &*(lparam as *const KBDLLHOOKSTRUCT);
        if event.vkCode == 27 {
            if let Ok(state) = quick_capture_state_store().try_lock() {
                if !matches!(*state, QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
                    QUICK_CAPTURE_ESCAPE_HOOK_ARMED.store(false, Ordering::SeqCst);
                    QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.store(false, Ordering::SeqCst);
                    return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
                }
            }
            QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.store(true, Ordering::SeqCst);
            return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
        }
    }
    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn start_quick_capture_escape_hook(app: AppHandle) {
    if QUICK_CAPTURE_ESCAPE_HOOK_STARTED.set(()).is_err() {
        return;
    }

    let dispatcher_app = app.clone();
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(25));
        if !QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.swap(false, Ordering::SeqCst) {
            continue;
        }
        let app_for_escape = dispatcher_app.clone();
        run_quick_capture_on_main(&app_for_escape, move |app_handle| {
            if !quick_capture_panel_is_active() {
                return;
            }
            close_quick_capture_panel_from_escape(&app_handle);
        });
    });

    thread::spawn(move || unsafe {
        let module = GetModuleHandleW(std::ptr::null());
        let hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(quick_capture_keyboard_hook),
            module,
            0,
        );
        if hook.is_null() {
            set_quick_capture_escape_error(Some("Esc hook unavailable".to_string()));
            return;
        }

        let mut message: MSG = std::mem::zeroed();
        while GetMessageW(&mut message, std::ptr::null_mut(), 0, 0) > 0 {
            if QUICK_CAPTURE_ESCAPE_HOOK_REQUESTED.swap(false, Ordering::SeqCst) {
                let app_for_escape = app.clone();
                run_quick_capture_on_main(&app_for_escape, move |app_handle| {
                    close_quick_capture_panel_from_escape(&app_handle);
                });
            }
            TranslateMessage(&message);
            DispatchMessageW(&message);
        }
    });
}

fn panel_recovering_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_PANEL_RECOVERING.get_or_init(|| Mutex::new(false))
}

fn panel_recovering_since_store() -> &'static Mutex<Option<Instant>> {
    QUICK_CAPTURE_PANEL_RECOVERING_SINCE.get_or_init(|| Mutex::new(None))
}

fn set_panel_recovering(recovering: bool) {
    *panel_recovering_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = recovering;
    *panel_recovering_since_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = recovering.then(Instant::now);
}

fn quick_capture_panel_recovering() -> bool {
    let recovering = *panel_recovering_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !recovering {
        return false;
    }

    let started_at = *panel_recovering_since_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if started_at
        .map(|instant| instant.elapsed() <= Duration::from_secs(3))
        .unwrap_or(false)
    {
        return true;
    }

    set_panel_recovering(false);
    false
}

fn quick_capture_panel_transitioning() -> bool {
    *panel_opening_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        || quick_capture_panel_recovering()
}

fn begin_panel_open() -> Option<QuickCapturePanelOpenGuard> {
    let mut opening = panel_opening_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *opening {
        return None;
    }
    *opening = true;
    Some(QuickCapturePanelOpenGuard)
}

fn quick_capture_state() -> QuickCaptureState {
    *quick_capture_state_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn set_quick_capture_state(state: QuickCaptureState) {
    *quick_capture_state_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = state;
}

fn ready_windows_store() -> &'static Mutex<HashSet<String>> {
    QUICK_CAPTURE_READY_WINDOWS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn destroy_reconcile_suppressions_store() -> &'static Mutex<HashSet<String>> {
    QUICK_CAPTURE_DESTROY_RECONCILE_SUPPRESSIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn suppress_next_destroy_reconcile(label: &str) {
    destroy_reconcile_suppressions_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(label.to_string());
}

fn take_destroy_reconcile_suppression(label: &str) -> bool {
    destroy_reconcile_suppressions_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(label)
}

fn mark_quick_capture_ready(label: &str) {
    ready_windows_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(label.to_string());
}

fn clear_quick_capture_ready(label: &str) {
    ready_windows_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(label);
}

fn clear_quick_capture_ready_state(label: &str) {
    if label == QUICK_CAPTURE_PANEL_LABEL {
        clear_panel_ready_token();
    } else if label == QUICK_CAPTURE_HOTZONE_LABEL {
        clear_hotzone_ready_token();
    }
}

fn invalidate_quick_capture_window_session(label: &str) {
    clear_quick_capture_ready_state(label);
}

fn invalidate_quick_capture_window_lifecycle(label: &str) {
    clear_quick_capture_ready(label);
    clear_quick_capture_ready_state(label);
    if label == QUICK_CAPTURE_PANEL_LABEL {
        set_panel_saving_token(None);
        next_panel_open_token();
    } else if label == QUICK_CAPTURE_HOTZONE_LABEL {
        next_hotzone_open_token();
    }
}

fn is_quick_capture_ready(label: &str) -> bool {
    ready_windows_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(label)
}

fn panel_failures_store() -> &'static Mutex<u8> {
    QUICK_CAPTURE_PANEL_FAILURES.get_or_init(|| Mutex::new(0))
}

fn hotzone_failures_store() -> &'static Mutex<u8> {
    QUICK_CAPTURE_HOTZONE_FAILURES.get_or_init(|| Mutex::new(0))
}

fn hotzone_watch_running_store() -> &'static Mutex<Option<u64>> {
    QUICK_CAPTURE_HOTZONE_WATCHING.get_or_init(|| Mutex::new(None))
}

fn hotzone_reopen_blocked_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_HOTZONE_REOPEN_BLOCKED.get_or_init(|| Mutex::new(false))
}

fn suppress_quick_capture_hotzone_reopen() {
    *hotzone_reopen_blocked_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = true;
}

fn quick_capture_hotzone_reopen_suppressed() -> bool {
    *hotzone_reopen_blocked_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn clear_quick_capture_hotzone_reopen_suppression() {
    *hotzone_reopen_blocked_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
}

fn panel_soft_retries_store() -> &'static Mutex<BTreeMap<u64, u8>> {
    QUICK_CAPTURE_PANEL_SOFT_RETRIES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn hotzone_soft_retries_store() -> &'static Mutex<BTreeMap<u64, u8>> {
    QUICK_CAPTURE_HOTZONE_SOFT_RETRIES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn reset_panel_soft_retry(token: u64) {
    panel_soft_retries_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&token);
}

fn reset_hotzone_soft_retry(token: u64) {
    hotzone_soft_retries_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&token);
}

fn reset_hotzone_failures() {
    *hotzone_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn increment_hotzone_failures() -> u8 {
    let mut failures = hotzone_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *failures = failures.saturating_add(1);
    *failures
}

fn reset_panel_failures() {
    *panel_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn increment_panel_failures() -> u8 {
    let mut failures = panel_failures_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *failures = failures.saturating_add(1);
    *failures
}

fn panel_open_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_PANEL_OPEN_TOKEN.get_or_init(|| Mutex::new(0))
}

fn next_panel_open_token() -> u64 {
    let mut token = panel_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *token = token.saturating_add(1);
    *token
}

fn current_panel_open_token() -> u64 {
    *panel_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn panel_ready_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_PANEL_READY_TOKEN.get_or_init(|| Mutex::new(0))
}

fn mark_panel_ready_for_token(token: u64) {
    *panel_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = token;
}

fn clear_panel_ready_token() {
    *panel_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn is_panel_ready_for_token(token: u64) -> bool {
    token != 0
        && *panel_ready_token_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            == token
}

fn panel_saving_token_store() -> &'static Mutex<Option<u64>> {
    QUICK_CAPTURE_PANEL_SAVING_TOKEN.get_or_init(|| Mutex::new(None))
}

fn set_panel_saving_token(token: Option<u64>) {
    *panel_saving_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = token;
}

fn clear_panel_saving_token(token: u64) {
    let mut saving_token = panel_saving_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *saving_token == Some(token) {
        *saving_token = None;
    }
}

fn panel_is_saving(token: u64) -> bool {
    token != 0
        && *panel_saving_token_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            == Some(token)
}

pub(crate) fn current_panel_is_saving() -> bool {
    panel_is_saving(current_panel_open_token())
}

fn hotzone_open_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_HOTZONE_OPEN_TOKEN.get_or_init(|| Mutex::new(0))
}

fn next_hotzone_open_token() -> u64 {
    let mut token = hotzone_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *token = token.saturating_add(1);
    *token
}

fn current_hotzone_open_token() -> u64 {
    *hotzone_open_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn hotzone_ready_token_store() -> &'static Mutex<u64> {
    QUICK_CAPTURE_HOTZONE_READY_TOKEN.get_or_init(|| Mutex::new(0))
}

fn mark_hotzone_ready_for_token(token: u64) {
    *hotzone_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = token;
}

fn clear_hotzone_ready_token() {
    *hotzone_ready_token_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = 0;
}

fn is_hotzone_ready_for_token(token: u64) -> bool {
    token != 0
        && *hotzone_ready_token_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            == token
}

fn degraded_notice_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_DEGRADED_NOTICE_SENT.get_or_init(|| Mutex::new(false))
}

fn degraded_store() -> &'static Mutex<bool> {
    QUICK_CAPTURE_DEGRADED.get_or_init(|| Mutex::new(false))
}

fn degraded_reason_store() -> &'static Mutex<Option<String>> {
    QUICK_CAPTURE_DEGRADED_REASON.get_or_init(|| Mutex::new(None))
}

fn shortcut_error_store() -> &'static Mutex<Option<String>> {
    QUICK_CAPTURE_SHORTCUT_ERROR.get_or_init(|| Mutex::new(None))
}

pub(crate) fn set_quick_capture_shortcut_error(message: Option<String>) {
    *shortcut_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = message;
}

fn quick_capture_shortcut_error() -> Option<String> {
    shortcut_error_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

pub(crate) fn quick_capture_degraded() -> bool {
    *degraded_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_quick_capture_degraded(value: bool) {
    *degraded_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = value;
}

fn set_quick_capture_degraded_reason(message: Option<String>) {
    *degraded_reason_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = message;
}

pub(crate) fn quick_capture_degraded_reason() -> Option<String> {
    degraded_reason_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn clear_quick_capture_degraded() {
    set_quick_capture_degraded(false);
    set_quick_capture_degraded_reason(None);
    reset_panel_failures();
    reset_hotzone_failures();
    reset_panel_soft_retry(current_panel_open_token());
    reset_hotzone_soft_retry(current_hotzone_open_token());
    *degraded_notice_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
}

fn invalidate_quick_capture_window_tokens() {
    next_panel_open_token();
    next_hotzone_open_token();
    clear_panel_ready_token();
    clear_hotzone_ready_token();
    clear_quick_capture_ready(QUICK_CAPTURE_PANEL_LABEL);
    clear_quick_capture_ready(QUICK_CAPTURE_HOTZONE_LABEL);
}

fn main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "主窗口不可用".to_string())
}

fn quick_capture_monitor_store() -> &'static Mutex<Option<QuickCaptureMonitor>> {
    QUICK_CAPTURE_MONITOR.get_or_init(|| Mutex::new(None))
}

fn quick_capture_anchor_store() -> &'static Mutex<QuickCaptureAnchor> {
    QUICK_CAPTURE_ANCHOR.get_or_init(|| Mutex::new(QuickCaptureAnchor::Center))
}

fn quick_capture_anchor() -> QuickCaptureAnchor {
    *quick_capture_anchor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn set_quick_capture_anchor(anchor: QuickCaptureAnchor) {
    *quick_capture_anchor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = anchor;
}

fn anchored_x(monitor_x: f64, monitor_width: f64, window_width: f64, anchor: QuickCaptureAnchor, edge_margin: f64) -> f64 {
    let available = (monitor_width - window_width).max(0.0);
    match anchor {
        QuickCaptureAnchor::Left => monitor_x + edge_margin.min(available),
        QuickCaptureAnchor::Center => monitor_x + available / 2.0,
        QuickCaptureAnchor::Right => monitor_x + (available - edge_margin).max(0.0),
    }
}

fn anchor_for_panel_center(monitor_x: f64, monitor_width: f64, panel_center_x: f64) -> QuickCaptureAnchor {
    let relative_x = panel_center_x - monitor_x;
    if relative_x < monitor_width / 3.0 {
        QuickCaptureAnchor::Left
    } else if relative_x >= monitor_width * 2.0 / 3.0 {
        QuickCaptureAnchor::Right
    } else {
        QuickCaptureAnchor::Center
    }
}

fn is_panel_detached(window_y: f64, monitor_y: f64, scale_factor: f64) -> bool {
    window_y - monitor_y > QUICK_CAPTURE_DETACHED_TOP_THRESHOLD * scale_factor.max(1.0)
}

fn remember_quick_capture_monitor(app: &AppHandle) -> Result<(), String> {
    let monitor = if let Ok(main) = main_window(app) {
        main
            .current_monitor()
            .map_err(|error| error.to_string())?
            .or(main
                .primary_monitor()
                .map_err(|error| error.to_string())?)
            .or(app.primary_monitor().map_err(|error| error.to_string())?)
    } else {
        app.primary_monitor().map_err(|error| error.to_string())?
    }
    .ok_or_else(|| "无法读取显示器信息".to_string())?;
    *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(QuickCaptureMonitor::from_monitor(&monitor));
    Ok(())
}

pub(crate) fn remember_primary_quick_capture_monitor(app: &AppHandle) -> Result<(), String> {
    let monitor = app
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法读取显示器信息".to_string())?;
    *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(QuickCaptureMonitor::from_monitor(&monitor));
    Ok(())
}

fn quick_capture_geometry(app: &AppHandle, width: u32, height: u32) -> Result<(LogicalPosition<f64>, LogicalSize<f64>), String> {
    let mut stored_monitor = *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    if stored_monitor.is_none() {
        if remember_quick_capture_monitor(app).is_err() {
            remember_primary_quick_capture_monitor(app)?;
        }
        stored_monitor = *quick_capture_monitor_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
    }

    let monitor = stored_monitor.ok_or_else(|| "Unable to read monitor information.".to_string())?;
    let x = anchored_x(
        monitor.logical_x,
        monitor.logical_width,
        width as f64,
        quick_capture_anchor(),
        QUICK_CAPTURE_EDGE_MARGIN,
    );
    let y = monitor.logical_y;

    Ok((LogicalPosition::new(x, y), LogicalSize::new(width as f64, height as f64)))
}

fn quick_capture_window(
    app: &AppHandle,
    label: &str,
    page: &str,
    width: u32,
    height: u32,
    focused: bool,
    transparent: bool,
) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(label) {
        let keep_detached_position =
            label == QUICK_CAPTURE_PANEL_LABEL && quick_capture_state() == QuickCaptureState::PanelDetached;
        if !keep_detached_position {
            let (position, size) = quick_capture_geometry(app, width, height)?;
            window.set_size(size).map_err(|error| error.to_string())?;
            window.set_position(position).map_err(|error| error.to_string())?;
        }
        window.set_always_on_top(true).map_err(|error| error.to_string())?;
        window.set_skip_taskbar(true).map_err(|error| error.to_string())?;
        window.unminimize().ok();
        window.show().map_err(|error| error.to_string())?;
        if focused {
            window.set_focus().ok();
        }
        return Ok(window);
    }

    let (position, size) = quick_capture_geometry(app, width, height)?;
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App(page.into()),
    )
    .title("快速记")
    .inner_size(size.width, size.height)
    .position(position.x, position.y)
    .decorations(false)
    .resizable(false)
    .transparent(transparent)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(true)
    .enable_clipboard_access()
    .shadow(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    if focused {
        window.set_focus().ok();
    }
    Ok(window)
}

#[allow(dead_code)]
fn prewarm_quick_capture_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL).is_some() {
        return Ok(());
    }

    remember_quick_capture_monitor(app).ok();
    let (position, size) = quick_capture_geometry(app, QUICK_CAPTURE_HOT_WIDTH, QUICK_CAPTURE_HOT_HEIGHT)?;
    let mut builder = WebviewWindowBuilder::new(
        app,
        QUICK_CAPTURE_HOTZONE_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("快速记")
    .inner_size(size.width, size.height)
    .position(position.x, position.y)
    .decorations(false)
    .resizable(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(false)
    .enable_clipboard_access()
    .shadow(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    let _ = window.hide();
    for _ in 0..10 {
        if is_quick_capture_ready(QUICK_CAPTURE_HOTZONE_LABEL) {
            break;
        }
        thread::sleep(Duration::from_millis(80));
    }
    Ok(())
}

#[allow(dead_code)]
fn prewarm_quick_capture_hidden_window(
    app: &AppHandle,
    label: &str,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if app.get_webview_window(label).is_some() {
        return Ok(());
    }

    let (position, size) = quick_capture_geometry(app, width, height)?;
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("快速记")
        .inner_size(size.width, size.height)
        .position(position.x, position.y)
        .decorations(false)
        .resizable(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .enable_clipboard_access()
        .shadow(false);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    let _ = window.hide();
    Ok(())
}

#[allow(dead_code)]
pub(crate) fn prewarm_quick_capture_windows(app: &AppHandle) -> Result<(), String> {
    remember_quick_capture_monitor(app).ok();
    prewarm_quick_capture_hidden_window(
        app,
        QUICK_CAPTURE_HOTZONE_LABEL,
        QUICK_CAPTURE_HOT_WIDTH,
        QUICK_CAPTURE_HOT_HEIGHT,
    )?;
    prewarm_quick_capture_hidden_window(
        app,
        QUICK_CAPTURE_PANEL_LABEL,
        QUICK_CAPTURE_PANEL_WIDTH,
        QUICK_CAPTURE_PANEL_HEIGHT,
    )?;
    Ok(())
}

pub(crate) fn quick_capture_panel_is_active() -> bool {
    matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
}

fn quick_capture_panel_is_visible(app: &AppHandle) -> bool {
    if !quick_capture_panel_is_active() {
        return false;
    }
    quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
}

pub(crate) fn quick_capture_panel_should_be_preserved(app: &AppHandle) -> bool {
    current_panel_is_saving()
        || quick_capture_panel_transitioning()
        || quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
}

fn panel_token_is_current(token: Option<u64>) -> bool {
    panel_token_matches(token, current_panel_open_token())
}

fn panel_token_matches(token: Option<u64>, current_token: u64) -> bool {
    matches!(token, Some(value) if value != 0 && value == current_token)
}

pub(crate) fn current_panel_token_option() -> Option<u64> {
    let token = current_panel_open_token();
    (token != 0).then_some(token)
}

fn effective_current_panel_token(token: Option<u64>) -> Option<u64> {
    match token {
        Some(value) if value != 0 && value == current_panel_open_token() => Some(value),
        Some(_) => token,
        None => current_panel_token_option(),
    }
}

fn schedule_panel_focus(app: AppHandle, token: u64) {
    thread::spawn(move || {
        for delay in [60_u64, 180, 420, 900, 1_600] {
            thread::sleep(Duration::from_millis(delay));
            run_quick_capture_on_main(&app, move |app_handle| {
                if current_panel_open_token() != token
                    || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                {
                    return;
                }
                if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
                    if panel.is_visible().unwrap_or(false) {
                        panel.set_focus().ok();
                    }
                }
            });
            if current_panel_open_token() != token {
                return;
            }
        }
    });
}

fn schedule_panel_show_kicks(app: AppHandle, token: u64) {
    thread::spawn(move || {
        for delay in [120_u64, 360, 720, 1_500, 3_000] {
            thread::sleep(Duration::from_millis(delay));
            run_quick_capture_on_main(&app, move |app_handle| {
                if current_panel_open_token() != token
                    || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                    || is_panel_ready_for_token(token)
                {
                    return;
                }
                if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
                    if panel.is_visible().unwrap_or(false) {
                        panel.emit("quick-capture:panel-show", token).ok();
                        panel.set_focus().ok();
                    }
                }
            });
            if current_panel_open_token() != token || is_panel_ready_for_token(token) {
                return;
            }
        }
    });
}

fn revive_visible_quick_capture_panel(app: &AppHandle) -> bool {
    if !quick_capture_panel_is_active() {
        return false;
    }
    let Some(existing_panel) = app.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) else {
        return false;
    };
    if !existing_panel.is_visible().unwrap_or(false) {
        return false;
    }
    let Ok(panel) = quick_capture_window(
        app,
        QUICK_CAPTURE_PANEL_LABEL,
        "index.html",
        QUICK_CAPTURE_PANEL_WIDTH,
        QUICK_CAPTURE_PANEL_HEIGHT,
        true,
        true,
    ) else {
        return false;
    };

    let open_token = next_panel_open_token();
    clear_quick_capture_ready_state(QUICK_CAPTURE_PANEL_LABEL);
    if quick_capture_state() != QuickCaptureState::PanelDetached {
        set_quick_capture_state(QuickCaptureState::PanelOpen);
    }
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    register_quick_capture_escape(app);
    panel.emit("quick-capture:panel-show", open_token).ok();
    panel.set_focus().ok();
    schedule_panel_show_kicks(app.clone(), open_token);
    schedule_panel_focus(app.clone(), open_token);
    schedule_panel_ready_watchdog(app.clone(), open_token);
    true
}

pub(crate) fn main_is_available_for_hotzone(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .map(|window| {
            let visible = window.is_visible().unwrap_or(false);
            let minimized = window.is_minimized().unwrap_or(false);
            visible && !minimized
        })
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn cursor_in_quick_capture_hotzone(app: &AppHandle) -> bool {
    if quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .is_none()
    {
        remember_quick_capture_monitor(app).ok();
    }
    let Some(monitor) = *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
    else {
        return false;
    };

    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return false;
    }

    let hot_width = QUICK_CAPTURE_HOT_WIDTH as f64 * monitor.scale_factor;
    let hot_height = (QUICK_CAPTURE_HOT_HEIGHT as f64).max(14.0) * monitor.scale_factor;
    let left = anchored_x(
        monitor.physical_x,
        monitor.physical_width,
        hot_width,
        quick_capture_anchor(),
        QUICK_CAPTURE_EDGE_MARGIN * monitor.scale_factor,
    )
    .round() as i32;
    let top = monitor.physical_y.round() as i32;
    let right = left.saturating_add(hot_width.round() as i32);
    let bottom = top.saturating_add(hot_height.round() as i32);
    cursor.x >= left && cursor.x < right && cursor.y >= top && cursor.y < bottom
}

#[cfg(target_os = "windows")]
fn schedule_hotzone_cursor_watch(app: AppHandle, token: u64) {
    {
        let mut active_token = hotzone_watch_running_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *active_token == Some(token) {
            return;
        }
        *active_token = Some(token);
    }

    thread::spawn(move || {
        let mut inside_since: Option<Instant> = None;
        loop {
            if current_hotzone_open_token() != token || quick_capture_state() != QuickCaptureState::HotzoneVisible {
                break;
            }

            if quick_capture_hotzone_reopen_suppressed() {
                if !cursor_in_quick_capture_hotzone(&app) {
                    clear_quick_capture_hotzone_reopen_suppression();
                }
                inside_since = None;
                thread::sleep(Duration::from_millis(QUICK_CAPTURE_HOTZONE_POLL_INTERVAL_MS));
                continue;
            }

            if cursor_in_quick_capture_hotzone(&app) {
                let entered_at = inside_since.get_or_insert_with(Instant::now);
                if entered_at.elapsed() >= Duration::from_millis(HOTZONE_HOVER_DELAY_MS) {
                    if current_hotzone_open_token() == token {
                        run_quick_capture_on_main(&app, move |app_handle| {
                            if current_hotzone_open_token() == token
                                && quick_capture_state() == QuickCaptureState::HotzoneVisible
                            {
                                let _ = show_quick_capture_panel_impl(&app_handle);
                            }
                        });
                    }
                    break;
                }
            } else {
                inside_since = None;
            }

            thread::sleep(Duration::from_millis(QUICK_CAPTURE_HOTZONE_POLL_INTERVAL_MS));
        }

        let mut active_token = hotzone_watch_running_store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *active_token == Some(token) {
            *active_token = None;
        }
    });
}

#[cfg(not(target_os = "windows"))]
fn schedule_hotzone_cursor_watch(_app: AppHandle, _token: u64) {}

#[cfg(target_os = "windows")]
fn cursor_in_quick_capture_window(window: &WebviewWindow) -> bool {
    let Ok(position) = window.outer_position() else {
        return false;
    };
    let Ok(size) = window.outer_size() else {
        return false;
    };
    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return false;
    }
    let right = position.x.saturating_add(size.width.min(i32::MAX as u32) as i32);
    let bottom = position.y.saturating_add(size.height.min(i32::MAX as u32) as i32);
    cursor.x >= position.x && cursor.x < right && cursor.y >= position.y && cursor.y < bottom
}

#[cfg(target_os = "windows")]
fn quick_capture_primary_pointer_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON as i32) as u16 & 0x8000) != 0 }
}

#[cfg(not(target_os = "windows"))]
fn cursor_in_quick_capture_window(_window: &WebviewWindow) -> bool {
    false
}

#[cfg(not(target_os = "windows"))]
fn quick_capture_primary_pointer_down() -> bool {
    false
}

fn quick_capture_window_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label)
        .map(|window| {
            window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false)
        })
        .unwrap_or(false)
}

pub(crate) fn hide_quick_capture_window(app: &AppHandle, label: &str) {
    if label == QUICK_CAPTURE_PANEL_LABEL && current_panel_is_saving() {
        return;
    }
    let event_token = if label == QUICK_CAPTURE_PANEL_LABEL {
        current_panel_open_token()
    } else if label == QUICK_CAPTURE_HOTZONE_LABEL {
        current_hotzone_open_token()
    } else {
        0
    };
    if let Some(window) = app.get_webview_window(label) {
        if window.hide().is_err() {
            return;
        }
        let event = if label == QUICK_CAPTURE_PANEL_LABEL {
            "quick-capture:panel-hide"
        } else {
            "quick-capture:hotzone-hide"
        };
        let _ = window.emit(event, event_token);
    }
    if label == QUICK_CAPTURE_PANEL_LABEL {
        set_panel_recovering(false);
        unregister_quick_capture_escape(app);
    }
    invalidate_quick_capture_window_session(label);
}

fn destroy_quick_capture_window(app: &AppHandle, label: &str) {
    if label == QUICK_CAPTURE_PANEL_LABEL && current_panel_is_saving() {
        return;
    }
    if let Some(window) = app.get_webview_window(label) {
        suppress_next_destroy_reconcile(label);
        if window.destroy().is_err() {
            let _ = take_destroy_reconcile_suppression(label);
            return;
        }
    }
    invalidate_quick_capture_window_lifecycle(label);
}

pub(crate) fn hide_quick_capture_windows(app: &AppHandle) {
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    hide_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);
}

fn hide_legacy_panel_window(app: &AppHandle) {
    if current_panel_is_saving() {
        return;
    }
    hide_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);
}

fn degrade_quick_capture(app: &AppHandle) {
    if current_panel_is_saving() {
        return;
    }
    let message = "顶部悬浮暂时不可用，已保留快捷键和托盘快速记录入口";
    set_panel_recovering(false);
    unregister_quick_capture_escape(app);
    invalidate_quick_capture_window_tokens();
    set_quick_capture_degraded(true);
    set_quick_capture_degraded_reason(Some(message.to_string()));
    set_quick_capture_state(QuickCaptureState::Degraded);
    destroy_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    destroy_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);

    let mut notice_sent = degraded_notice_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !*notice_sent {
        *notice_sent = true;
        let _ = app.emit("quick-capture:degraded", message);
    }
}

fn schedule_panel_ready_watchdog(app: AppHandle, token: u64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(QUICK_CAPTURE_READY_TIMEOUT_MS));
        if current_panel_open_token() != token || is_panel_ready_for_token(token) {
            reset_panel_soft_retry(token);
            reset_panel_failures();
            return;
        }

        if panel_is_saving(token) {
            return;
        }

        if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_PANEL_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_panel_open_token() == token
                && matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                && quick_capture_window_visible(&app_handle, QUICK_CAPTURE_PANEL_LABEL)
            {
                if let Some(panel) = app_handle.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
                    panel.emit("quick-capture:panel-show", token).ok();
                    panel.set_focus().ok();
                }
            }
        });

        thread::sleep(Duration::from_millis(450));

        if current_panel_open_token() != token || is_panel_ready_for_token(token) {
            reset_panel_soft_retry(token);
            reset_panel_failures();
            return;
        }

        if current_panel_open_token() != token
            || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_PANEL_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_panel_open_token() != token
                || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
                || !quick_capture_window_visible(&app_handle, QUICK_CAPTURE_PANEL_LABEL)
                || panel_is_saving(token)
            {
                return;
            }
            let failures = increment_panel_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                reset_panel_soft_retry(token);
                reset_panel_failures();
                degrade_quick_capture(&app_handle);
                return;
            }

            reset_panel_soft_retry(token);
            set_panel_recovering(true);
            destroy_quick_capture_window(&app_handle, QUICK_CAPTURE_PANEL_LABEL);
            let retry_app = app_handle.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(180));
                let dispatched = run_quick_capture_on_main(&retry_app, move |retry_handle| {
                    if matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
                        if show_quick_capture_panel_impl(&retry_handle).is_err() {
                            set_panel_recovering(false);
                            degrade_quick_capture(&retry_handle);
                            return;
                        }
                    }
                    set_panel_recovering(false);
                });
                if !dispatched {
                    set_panel_recovering(false);
                }
            });
        });
    });
}

fn schedule_hotzone_ready_watchdog(app: AppHandle, token: u64) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(QUICK_CAPTURE_READY_TIMEOUT_MS));
        if current_hotzone_open_token() != token || is_hotzone_ready_for_token(token) {
            reset_hotzone_soft_retry(token);
            reset_hotzone_failures();
            return;
        }

        if quick_capture_state() != QuickCaptureState::HotzoneVisible
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_HOTZONE_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_hotzone_open_token() == token
                && quick_capture_state() == QuickCaptureState::HotzoneVisible
                && quick_capture_window_visible(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL)
            {
                if let Some(hotzone) = app_handle.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                    hotzone.emit("quick-capture:hotzone-show", token).ok();
                }
            }
        });

        thread::sleep(Duration::from_millis(450));

        if current_hotzone_open_token() != token || is_hotzone_ready_for_token(token) {
            reset_hotzone_soft_retry(token);
            reset_hotzone_failures();
            return;
        }

        if current_hotzone_open_token() != token
            || quick_capture_state() != QuickCaptureState::HotzoneVisible
            || !quick_capture_window_visible(&app, QUICK_CAPTURE_HOTZONE_LABEL)
        {
            return;
        }

        run_quick_capture_on_main(&app, move |app_handle| {
            if current_hotzone_open_token() != token
                || quick_capture_state() != QuickCaptureState::HotzoneVisible
                || !quick_capture_window_visible(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL)
            {
                return;
            }

            let failures = increment_hotzone_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                reset_hotzone_soft_retry(token);
                reset_hotzone_failures();
                degrade_quick_capture(&app_handle);
                return;
            }

            reset_hotzone_soft_retry(token);
            destroy_quick_capture_window(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL);
            let retry_app = app_handle.clone();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(180));
                let _ = run_quick_capture_on_main(&retry_app, move |retry_handle| {
                    if quick_capture_paused() {
                        set_quick_capture_state(QuickCaptureState::Paused);
                        hide_quick_capture_windows(&retry_handle);
                        return;
                    }
                    if quick_capture_degraded() {
                        set_quick_capture_state(QuickCaptureState::Degraded);
                        hide_quick_capture_windows(&retry_handle);
                        return;
                    }
                    if main_is_available_for_hotzone(&retry_handle) {
                        set_quick_capture_state(QuickCaptureState::MainVisible);
                        hide_quick_capture_windows(&retry_handle);
                        return;
                    }
                    if show_quick_capture_hotzone_for_hidden_main_impl(&retry_handle).is_err() {
                        degrade_quick_capture(&retry_handle);
                    }
                });
            });
        });
    });
}

pub(crate) fn show_quick_capture_hotzone_impl(app: &AppHandle) -> Result<(), String> {
    show_quick_capture_hotzone_impl_with(app, false)
}

pub(crate) fn show_quick_capture_hotzone_for_hidden_main_impl(app: &AppHandle) -> Result<(), String> {
    show_quick_capture_hotzone_impl_with(app, true)
}

pub(crate) fn show_quick_capture_hotzone_impl_with(app: &AppHandle, force_hidden_main: bool) -> Result<(), String> {
    if main_window_startup_pending() {
        set_quick_capture_state(QuickCaptureState::MainVisible);
        hide_quick_capture_windows(app);
        return Ok(());
    }

    if current_panel_is_saving() && quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL) {
        return Ok(());
    }

    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        hide_quick_capture_windows(app);
        return Ok(());
    }

    if quick_capture_degraded() || (!force_hidden_main && main_is_available_for_hotzone(app)) {
        if quick_capture_degraded() {
            set_quick_capture_state(QuickCaptureState::Degraded);
        } else {
            set_quick_capture_state(QuickCaptureState::MainVisible);
        }
        hide_quick_capture_windows(app);
        return Ok(());
    }

    if quick_capture_state() == QuickCaptureState::HotzoneVisible && current_hotzone_open_token() != 0 {
        let token = current_hotzone_open_token();
        if quick_capture_window_visible(app, QUICK_CAPTURE_HOTZONE_LABEL) {
            if let Some(hotzone) = app.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                hotzone.emit("quick-capture:hotzone-show", token).ok();
            }
            schedule_hotzone_cursor_watch(app.clone(), token);
            schedule_hotzone_ready_watchdog(app.clone(), token);
            return Ok(());
        }
    }

    hide_legacy_panel_window(app);
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    let hotzone_token = next_hotzone_open_token();
    clear_quick_capture_ready_state(QUICK_CAPTURE_HOTZONE_LABEL);
    if current_hotzone_open_token() != hotzone_token
        || quick_capture_paused()
        || quick_capture_degraded()
        || (!force_hidden_main && main_is_available_for_hotzone(app))
        || quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
    {
        if current_hotzone_open_token() == hotzone_token {
            if quick_capture_paused() {
                set_quick_capture_state(QuickCaptureState::Paused);
            } else if quick_capture_degraded() {
                set_quick_capture_state(QuickCaptureState::Degraded);
            } else if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
        }
        return Ok(());
    }
    let hotzone = match quick_capture_window(
        app,
        QUICK_CAPTURE_HOTZONE_LABEL,
        "index.html",
        QUICK_CAPTURE_HOT_WIDTH,
        QUICK_CAPTURE_HOT_HEIGHT,
        false,
        true,
    ) {
        Ok(window) => window,
        Err(error) => {
            let failures = increment_hotzone_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                degrade_quick_capture(app);
            } else if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
            return Err(error);
        }
    };
    if current_hotzone_open_token() != hotzone_token
        || quick_capture_paused()
        || quick_capture_degraded()
        || (!force_hidden_main && main_is_available_for_hotzone(app))
        || quick_capture_window_visible(app, QUICK_CAPTURE_PANEL_LABEL)
    {
        if current_hotzone_open_token() == hotzone_token {
            hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
            if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
        }
        return Ok(());
    }
    set_quick_capture_state(QuickCaptureState::HotzoneVisible);
    hotzone.emit("quick-capture:hotzone-show", hotzone_token).ok();
    schedule_hotzone_cursor_watch(app.clone(), hotzone_token);
    schedule_hotzone_ready_watchdog(app.clone(), hotzone_token);
    Ok(())
}

pub(crate) fn show_quick_capture_panel_impl(app: &AppHandle) -> Result<(), String> {
    if main_window_startup_pending() {
        set_quick_capture_state(QuickCaptureState::MainVisible);
        hide_quick_capture_windows(app);
        return Ok(());
    }

    if current_panel_is_saving() {
        if let Some(panel) = app.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
            if panel.is_visible().unwrap_or(false) {
                panel.set_focus().ok();
                return Ok(());
            }
        }
    }
    let Some(_opening_guard) = begin_panel_open() else {
        return Ok(());
    };

    if revive_visible_quick_capture_panel(app) {
        return Ok(());
    }

    let open_token = next_panel_open_token();
    clear_quick_capture_ready_state(QUICK_CAPTURE_PANEL_LABEL);
    let was_detached = quick_capture_state() == QuickCaptureState::PanelDetached
        && app
            .get_webview_window(QUICK_CAPTURE_PANEL_LABEL)
            .map(|window| window.is_visible().unwrap_or(false))
            .unwrap_or(false);
    if !was_detached {
        set_quick_capture_state(QuickCaptureState::PanelOpen);
    }

    let panel = match quick_capture_window(
        app,
        QUICK_CAPTURE_PANEL_LABEL,
        "index.html",
        QUICK_CAPTURE_PANEL_WIDTH,
        QUICK_CAPTURE_PANEL_HEIGHT,
        true,
        true,
    ) {
        Ok(window) => window,
        Err(error) => {
            set_panel_recovering(false);
            let failures = increment_panel_failures();
            if failures >= QUICK_CAPTURE_MAX_OPEN_FAILURES {
                degrade_quick_capture(app);
            } else if main_is_available_for_hotzone(app) {
                set_quick_capture_state(QuickCaptureState::MainVisible);
                hide_quick_capture_windows(app);
            } else {
                let _ = show_quick_capture_hotzone_for_hidden_main_impl(app);
            }
            return Err(error);
        }
    };
    if current_panel_open_token() != open_token
        || !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
    {
        if current_panel_open_token() == open_token {
            hide_quick_capture_window(app, QUICK_CAPTURE_PANEL_LABEL);
        }
        return Ok(());
    }
    hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    if current_panel_open_token() != open_token {
        return Ok(());
    }
    set_quick_capture_state(if was_detached {
        QuickCaptureState::PanelDetached
    } else {
        QuickCaptureState::PanelOpen
    });
    register_quick_capture_escape(app);
    panel.emit("quick-capture:panel-show", open_token).ok();
    panel.set_focus().ok();
    schedule_panel_show_kicks(app.clone(), open_token);
    schedule_panel_focus(app.clone(), open_token);
    schedule_panel_ready_watchdog(app.clone(), open_token);
    set_panel_recovering(false);
    Ok(())
}

pub(crate) fn hide_quick_capture_panel_impl(app: &AppHandle, token: Option<u64>) -> Result<bool, String> {
    if !panel_token_is_current(token) {
        return Ok(false);
    }
    if let Some(token_value) = effective_current_panel_token(token) {
        if panel_is_saving(token_value) {
            return Ok(false);
        }
    }
    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        hide_quick_capture_windows(app);
        return Ok(true);
    }
    if quick_capture_degraded() || main_is_available_for_hotzone(app) {
        set_quick_capture_state(if quick_capture_degraded() {
            QuickCaptureState::Degraded
        } else {
            QuickCaptureState::MainVisible
        });
        hide_quick_capture_windows(app);
        return Ok(true);
    }
    suppress_quick_capture_hotzone_reopen();
    show_quick_capture_hotzone_for_hidden_main_impl(app)?;
    Ok(true)
}

pub(crate) fn return_quick_capture_to_hotzone_impl(app: &AppHandle, token: Option<u64>) -> Result<bool, String> {
    if !panel_token_is_current(token) {
        return Ok(false);
    }
    if let Some(token_value) = effective_current_panel_token(token) {
        if panel_is_saving(token_value) {
            return Ok(false);
        }
    }
    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        hide_quick_capture_windows(app);
        return Ok(true);
    }

    if quick_capture_degraded() || main_is_available_for_hotzone(app) {
        set_quick_capture_state(if quick_capture_degraded() {
            QuickCaptureState::Degraded
        } else {
            QuickCaptureState::MainVisible
        });
        hide_quick_capture_windows(app);
        return Ok(true);
    }

    suppress_quick_capture_hotzone_reopen();
    show_quick_capture_hotzone_for_hidden_main_impl(app)?;
    Ok(true)
}

pub(crate) fn reconcile_quick_capture_window_destroyed(app: &AppHandle, label: &str) {
    if app.get_webview_window(label).is_some() {
        return;
    }

    if take_destroy_reconcile_suppression(label) {
        return;
    }

    invalidate_quick_capture_window_lifecycle(label);

    if quick_capture_paused() {
        set_quick_capture_state(QuickCaptureState::Paused);
        return;
    }

    if label == QUICK_CAPTURE_PANEL_LABEL {
        unregister_quick_capture_escape(app);
        set_panel_recovering(false);
        if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
            return;
        }

        if quick_capture_degraded() {
            set_quick_capture_state(QuickCaptureState::Degraded);
        } else if main_is_available_for_hotzone(app) {
            set_quick_capture_state(QuickCaptureState::MainVisible);
        } else {
            let _ = show_quick_capture_hotzone_for_hidden_main_impl(app);
        }
        return;
    }

    if label == QUICK_CAPTURE_HOTZONE_LABEL && quick_capture_state() == QuickCaptureState::HotzoneVisible {
        if quick_capture_degraded() {
            set_quick_capture_state(QuickCaptureState::Degraded);
        } else if main_is_available_for_hotzone(app) {
            set_quick_capture_state(QuickCaptureState::MainVisible);
        } else {
            let _ = show_quick_capture_hotzone_for_hidden_main_impl(app);
        }
    }
}

fn show_main(app: &AppHandle) -> Result<(), String> {
    if main_window_startup_pending() {
        return Ok(());
    }

    let main = main_window(app)?;
    let preserve_panel = quick_capture_panel_should_be_preserved(app);
    if preserve_panel {
        hide_quick_capture_window(app, QUICK_CAPTURE_HOTZONE_LABEL);
    } else {
        set_quick_capture_state(QuickCaptureState::MainVisible);
        hide_quick_capture_windows(app);
    }
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    remember_quick_capture_monitor(app).ok();
    if preserve_panel {
        if let Some(panel) = app.get_webview_window(QUICK_CAPTURE_PANEL_LABEL) {
            panel.set_focus().ok();
        }
        Ok(())
    } else {
        main.set_focus().map_err(|error| error.to_string())
    }
}

pub(crate) fn open_main_from_quick_capture_impl(app: &AppHandle) -> Result<(), String> {
    if main_window_startup_pending() {
        return Ok(());
    }

    if current_panel_is_saving() {
        return Err("快速记录正在保存，请稍后再打开 Daymark".into());
    }

    let main = main_window(app)?;
    set_quick_capture_state(QuickCaptureState::MainVisible);
    hide_quick_capture_windows(app);
    main.show().map_err(|error| error.to_string())?;
    main.unminimize().map_err(|error| error.to_string())?;
    remember_quick_capture_monitor(app).ok();
    main.set_focus().map_err(|error| error.to_string())
}

pub(crate) fn route_second_launch_to_main(app: &AppHandle) {
    let app_handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = show_main(&app_handle);
    });
}

pub(crate) fn hide_main(app: &AppHandle) -> Result<(), String> {
    let main = main_window(app)?;
    remember_quick_capture_monitor(app).ok();
    if quick_capture_panel_should_be_preserved(app) {
        main.hide().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let result = show_quick_capture_hotzone_for_hidden_main_impl(app).or_else(|error| {
        degrade_quick_capture(app);
        Err(error)
    });
    if result.is_err() && main.is_visible().unwrap_or(false) && !main.is_minimized().unwrap_or(false) {
        return result;
    }
    main.hide().map_err(|error| error.to_string())?;
    schedule_hotzone_after_main_hide(app.clone());
    result
}

fn schedule_hotzone_after_main_hide(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(180));
        sync_quick_capture_lifecycle_on_main(&app);
    });
}

pub(crate) fn schedule_main_minimized_check(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(180));
        sync_quick_capture_lifecycle_on_main(&app);
    });
}

pub(crate) fn start_quick_capture_lifecycle_watchdog(app: AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(420));
        sync_quick_capture_lifecycle_on_main(&app);
    });
}

fn sync_quick_capture_lifecycle_on_main(app: &AppHandle) {
    if QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app_handle = app.clone();
    let dispatched = app.run_on_main_thread(move || {
        QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING.store(false, Ordering::SeqCst);
        if quick_capture_paused() {
            if quick_capture_panel_should_be_preserved(&app_handle) {
                hide_quick_capture_window(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL);
                return;
            }
            set_quick_capture_state(QuickCaptureState::Paused);
            hide_quick_capture_windows(&app_handle);
            return;
        }

        if quick_capture_degraded() {
            return;
        }

        if main_window_startup_pending() {
            set_quick_capture_state(QuickCaptureState::MainVisible);
            hide_quick_capture_windows(&app_handle);
            return;
        }

        let Some(main) = app_handle.get_webview_window("main") else {
            return;
        };

        let minimized = main.is_minimized().unwrap_or(false);
        let visible = main.is_visible().unwrap_or(false);
        let focused = main.is_focused().unwrap_or(false);
        let panel_active = quick_capture_panel_is_active();
        let panel_visible = quick_capture_panel_is_visible(&app_handle);
        let panel_transitioning = quick_capture_panel_transitioning();
        let hotzone_visible = quick_capture_window_visible(&app_handle, QUICK_CAPTURE_HOTZONE_LABEL);

        if panel_active && !panel_visible {
            if panel_transitioning {
                return;
            }
            if visible && !minimized {
                set_quick_capture_state(QuickCaptureState::MainVisible);
                hide_quick_capture_windows(&app_handle);
            } else {
                set_quick_capture_state(QuickCaptureState::HotzoneVisible);
                if hotzone_visible {
                    if let Some(hotzone) = app_handle.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                        let token = current_hotzone_open_token();
                        if token != 0 {
                            hotzone.emit("quick-capture:hotzone-show", token).ok();
                        }
                    }
                } else {
                let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
                }
            }
            return;
        }

        if minimized {
            remember_quick_capture_monitor(&app_handle).ok();
            if !panel_active && !panel_visible && !panel_transitioning {
                if hotzone_visible {
                    set_quick_capture_state(QuickCaptureState::HotzoneVisible);
                } else {
                    let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
                }
            }
            return;
        }

        if visible {
            if focused
                && !panel_visible
                && !panel_active
                && !panel_transitioning
                && hotzone_visible
            {
                set_quick_capture_state(QuickCaptureState::MainVisible);
                hide_quick_capture_windows(&app_handle);
                return;
            }
            if !panel_active
                && !panel_visible
                && !panel_transitioning
                && hotzone_visible
            {
                hide_quick_capture_windows(&app_handle);
                set_quick_capture_state(QuickCaptureState::MainVisible);
            }
            return;
        }

        if !panel_active && !panel_visible && !panel_transitioning && hotzone_visible {
            set_quick_capture_state(QuickCaptureState::HotzoneVisible);
            let token = current_hotzone_open_token();
            if token != 0 {
                if let Some(hotzone) = app_handle.get_webview_window(QUICK_CAPTURE_HOTZONE_LABEL) {
                    hotzone.emit("quick-capture:hotzone-show", token).ok();
                }
                schedule_hotzone_cursor_watch(app_handle.clone(), token);
                schedule_hotzone_ready_watchdog(app_handle.clone(), token);
            }
            return;
        }

        if !panel_active
            && !panel_visible
            && !panel_transitioning
            && !hotzone_visible
        {
            let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
        }
    });
    if dispatched.is_err() {
        QUICK_CAPTURE_LIFECYCLE_SYNC_PENDING.store(false, Ordering::SeqCst);
    }
}

#[tauri::command]
pub(crate) fn show_main_window(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_quick_capture_window(&window)?;
    show_main(&app)
}

#[tauri::command]
pub(crate) fn open_main_from_quick_capture(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_quick_capture_window(&window)?;
    open_main_from_quick_capture_impl(&app)
}

#[tauri::command]
pub(crate) fn hide_main_to_tray(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main_window(&window)?;
    hide_main(&app)
}

#[tauri::command]
pub(crate) fn show_quick_capture(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main_window(&window)?;
    show_quick_capture_panel_impl(&app)
}

#[tauri::command]
pub(crate) fn expand_quick_capture(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_quick_capture_hotzone_window(&window)?;
    show_quick_capture_panel_impl(&app)
}

#[tauri::command]
pub(crate) fn collapse_quick_capture(window: WebviewWindow, app: AppHandle) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    hide_quick_capture_panel_impl(&app, current_panel_token_option())
}

#[tauri::command]
pub(crate) fn show_quick_capture_hotzone(window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    ensure_main_window(&window)?;
    show_quick_capture_hotzone_impl(&app)
}

#[tauri::command]
pub(crate) fn show_quick_capture_panel(
    window: WebviewWindow,
    app: AppHandle,
    hotzone_token: Option<u64>,
    trigger: Option<String>,
) -> Result<bool, String> {
    if window.label() != "main" && window.label() != QUICK_CAPTURE_HOTZONE_LABEL {
        return Err("Quick capture can only be opened from main or hotzone.".into());
    }
    if window.label() == QUICK_CAPTURE_HOTZONE_LABEL {
        let click_trigger = matches!(trigger.as_deref(), Some("click") | Some("explicit"));
        if (!click_trigger && quick_capture_hotzone_reopen_suppressed())
            || quick_capture_state() != QuickCaptureState::HotzoneVisible
        {
            return Ok(false);
        }
        match hotzone_token {
            Some(token) if token != 0 && token == current_hotzone_open_token() => {}
            _ => {
                return Ok(false);
            }
        }
    }
    show_quick_capture_panel_impl(&app)?;
    Ok(true)
}

#[tauri::command]
pub(crate) fn hide_quick_capture_panel(window: WebviewWindow, app: AppHandle, token: Option<u64>) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    hide_quick_capture_panel_impl(&app, effective_current_panel_token(token))
}

#[tauri::command]
pub(crate) fn return_quick_capture_to_hotzone(
    window: WebviewWindow,
    app: AppHandle,
    token: Option<u64>,
) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    return_quick_capture_to_hotzone_impl(&app, effective_current_panel_token(token))
}

#[tauri::command]
pub(crate) fn quick_capture_window_ready(window: WebviewWindow, label: String, token: Option<u64>) -> Result<(), String> {
    if label != QUICK_CAPTURE_HOTZONE_LABEL && label != QUICK_CAPTURE_PANEL_LABEL {
        return Err("Unknown quick capture window label.".into());
    }
    if window.label() != label {
        return Ok(());
    }
    mark_quick_capture_ready(&label);

    let token = token.filter(|value| *value != 0);
    if token.is_none() {
        return Ok(());
    }
    if !window.is_visible().unwrap_or(false) || window.is_minimized().unwrap_or(false) {
        return Ok(());
    }
    if label == QUICK_CAPTURE_PANEL_LABEL {
        if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached) {
            return Ok(());
        }
        let panel_token = match token {
            Some(value) if value == current_panel_open_token() => value,
            _ => return Ok(()),
        };
        mark_panel_ready_for_token(panel_token);
    } else {
        if quick_capture_state() != QuickCaptureState::HotzoneVisible {
            return Ok(());
        }
        let hotzone_token = match token {
            Some(value) if value == current_hotzone_open_token() => value,
            _ => return Ok(()),
        };
        mark_hotzone_ready_for_token(hotzone_token);
    }
    if label == QUICK_CAPTURE_PANEL_LABEL {
        reset_panel_failures();
    } else {
        reset_hotzone_failures();
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_quick_capture_panel_token(window: WebviewWindow) -> Result<u64, String> {
    ensure_quick_capture_panel_window(&window)?;
    if !matches!(quick_capture_state(), QuickCaptureState::PanelOpen | QuickCaptureState::PanelDetached)
        || !window.is_visible().unwrap_or(false)
        || window.is_minimized().unwrap_or(false)
    {
        return Ok(0);
    }
    current_panel_open_token()
        .try_into()
        .map_err(|_| "Invalid quick capture token.".to_string())
}

#[tauri::command]
pub(crate) fn get_quick_capture_runtime_state() -> QuickCaptureRuntimeState {
    QuickCaptureRuntimeState {
        state: quick_capture_state().as_str(),
        anchor: quick_capture_anchor().as_str(),
        panel_token: current_panel_open_token(),
        hotzone_token: current_hotzone_open_token(),
        paused: quick_capture_paused(),
        degraded: quick_capture_degraded(),
        degraded_reason: quick_capture_degraded_reason(),
        shortcut_available: quick_capture_shortcut_error().is_none(),
        shortcut_error: quick_capture_shortcut_error(),
        escape_available: quick_capture_escape_error().is_none(),
        escape_error: quick_capture_escape_error(),
    }
}

#[tauri::command]
pub(crate) fn finalize_quick_capture_drag(
    window: WebviewWindow,
    app: AppHandle,
    token: Option<u64>,
) -> Result<QuickCaptureDragResult, String> {
    ensure_quick_capture_panel_window(&window)?;
    if !panel_token_is_current(token) || !quick_capture_panel_is_active() {
        return Ok(QuickCaptureDragResult {
            applied: false,
            still_dragging: false,
            detached: quick_capture_state() == QuickCaptureState::PanelDetached,
            anchor: quick_capture_anchor().as_str(),
            pointer_outside: false,
        });
    }

    if quick_capture_primary_pointer_down() {
        return Ok(QuickCaptureDragResult {
            applied: false,
            still_dragging: true,
            detached: quick_capture_state() == QuickCaptureState::PanelDetached,
            anchor: quick_capture_anchor().as_str(),
            pointer_outside: false,
        });
    }

    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or(app.primary_monitor().map_err(|error| error.to_string())?)
        .ok_or_else(|| "无法读取显示器信息".to_string())?;
    let monitor_data = QuickCaptureMonitor::from_monitor(&monitor);
    *quick_capture_monitor_store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(monitor_data);

    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let detached = is_panel_detached(
        position.y as f64,
        monitor_position.y as f64,
        monitor.scale_factor(),
    );

    if detached {
        set_quick_capture_state(QuickCaptureState::PanelDetached);
    } else {
        let panel_center_x = position.x as f64 + size.width as f64 / 2.0;
        let anchor = anchor_for_panel_center(
            monitor_position.x as f64,
            monitor_size.width as f64,
            panel_center_x,
        );
        set_quick_capture_anchor(anchor);
        set_quick_capture_state(QuickCaptureState::PanelOpen);
        let (anchored_position, anchored_size) =
            quick_capture_geometry(&app, QUICK_CAPTURE_PANEL_WIDTH, QUICK_CAPTURE_PANEL_HEIGHT)?;
        window.set_size(anchored_size).map_err(|error| error.to_string())?;
        window.set_position(anchored_position).map_err(|error| error.to_string())?;
    }

    Ok(QuickCaptureDragResult {
        applied: true,
        still_dragging: false,
        detached,
        anchor: quick_capture_anchor().as_str(),
        pointer_outside: !cursor_in_quick_capture_window(&window),
    })
}

#[tauri::command]
pub(crate) fn collapse_quick_capture_if_pointer_outside(
    window: WebviewWindow,
    app: AppHandle,
    token: Option<u64>,
) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    if !panel_token_is_current(token)
        || quick_capture_state() != QuickCaptureState::PanelOpen
        || current_panel_is_saving()
        || cursor_in_quick_capture_window(&window)
    {
        return Ok(false);
    }
    hide_quick_capture_panel_impl(&app, token)
}

#[tauri::command]
pub(crate) fn set_quick_capture_saving(window: WebviewWindow, saving: bool, token: Option<u64>) -> Result<(), String> {
    ensure_quick_capture_panel_window(&window)?;
    let Some(token_value) = token.filter(|value| *value != 0) else {
        return Ok(());
    };
    if token_value != current_panel_open_token() {
        return Ok(());
    }
    if saving {
        set_panel_saving_token(Some(token_value));
    } else {
        clear_panel_saving_token(token_value);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn notify_quick_capture_saved(window: WebviewWindow, app: AppHandle, token: Option<u64>) -> Result<bool, String> {
    ensure_quick_capture_panel_window(&window)?;
    let Some(token_value) = token.filter(|value| *value != 0) else {
        return Ok(false);
    };
    if token_value != current_panel_open_token() && !panel_is_saving(token_value) {
        return Ok(false);
    }
    app.emit("quick-capture:saved", ()).map_err(|error| error.to_string())?;
    Ok(true)
}

pub(crate) fn setup_tray(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let open = MenuItem::with_id(app, "open-main", "打开 Daymark", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick-capture", "快速记录 Ctrl+Shift+Space", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "toggle-quick-capture", "暂停/恢复顶部悬浮", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quick, &pause, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main-tray")
        .tooltip("Daymark")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open-main" => {
                dispatch_quick_capture_on_main(app, |app_handle| {
                    let _ = show_main(&app_handle);
                });
            }
            "quick-capture" => {
                dispatch_quick_capture_on_main(app, |app_handle| {
                    let _ = show_quick_capture_panel_impl(&app_handle);
                });
            }
            "toggle-quick-capture" => {
                dispatch_quick_capture_on_main(app, |app_handle| {
                    let paused = !quick_capture_paused();
                    set_quick_capture_paused(paused);
                    if paused {
                        set_quick_capture_state(QuickCaptureState::Paused);
                        hide_quick_capture_windows(&app_handle);
                    } else {
                        clear_quick_capture_degraded();
                        if quick_capture_panel_is_active() {
                            // Keep the explicit quick-capture panel where the user left it.
                        } else if !main_is_available_for_hotzone(&app_handle) {
                            let _ = show_quick_capture_hotzone_for_hidden_main_impl(&app_handle);
                        } else {
                            set_quick_capture_state(QuickCaptureState::MainVisible);
                        }
                    }
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                dispatch_quick_capture_on_main(tray.app_handle(), |app_handle| {
                    let _ = show_main(&app_handle);
                });
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        anchor_for_panel_center, anchored_x, is_panel_detached, panel_token_matches,
        QuickCaptureAnchor,
    };

    #[test]
    fn anchored_positions_use_stable_edge_margins() {
        assert_eq!(anchored_x(0.0, 1_920.0, 760.0, QuickCaptureAnchor::Left, 24.0), 24.0);
        assert_eq!(anchored_x(0.0, 1_920.0, 760.0, QuickCaptureAnchor::Center, 24.0), 580.0);
        assert_eq!(anchored_x(0.0, 1_920.0, 760.0, QuickCaptureAnchor::Right, 24.0), 1_136.0);
    }

    #[test]
    fn anchored_positions_do_not_overflow_small_monitors() {
        for anchor in [QuickCaptureAnchor::Left, QuickCaptureAnchor::Center, QuickCaptureAnchor::Right] {
            assert_eq!(anchored_x(120.0, 600.0, 760.0, anchor, 24.0), 120.0);
        }
    }

    #[test]
    fn panel_center_selects_left_center_and_right_thirds() {
        assert_eq!(anchor_for_panel_center(0.0, 1_920.0, 300.0), QuickCaptureAnchor::Left);
        assert_eq!(anchor_for_panel_center(0.0, 1_920.0, 960.0), QuickCaptureAnchor::Center);
        assert_eq!(anchor_for_panel_center(0.0, 1_920.0, 1_700.0), QuickCaptureAnchor::Right);
    }

    #[test]
    fn detached_threshold_scales_with_monitor() {
        assert!(!is_panel_detached(48.0, 0.0, 1.0));
        assert!(is_panel_detached(49.0, 0.0, 1.0));
        assert!(!is_panel_detached(72.0, 0.0, 1.5));
        assert!(is_panel_detached(73.0, 0.0, 1.5));
    }

    #[test]
    fn stale_and_empty_panel_tokens_are_rejected() {
        assert!(panel_token_matches(Some(8), 8));
        assert!(!panel_token_matches(Some(7), 8));
        assert!(!panel_token_matches(Some(0), 0));
        assert!(!panel_token_matches(None, 8));
    }
}
