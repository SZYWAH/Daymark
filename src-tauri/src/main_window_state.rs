use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

use crate::ensure_main_window;
use crate::quick_capture::{
    hide_quick_capture_windows, set_quick_capture_state, QuickCaptureState,
};

const MAIN_WINDOW_LABEL: &str = "main";
const WINDOW_STATE_FILENAME: &str = "daymark-main-window-state.json";
const PREFERRED_WIDTH: f64 = 1280.0;
const PREFERRED_HEIGHT: f64 = 820.0;
const MINIMUM_WIDTH: f64 = 1100.0;
const MINIMUM_HEIGHT: f64 = 720.0;
const WORK_AREA_RATIO: f64 = 0.88;
const MAIN_STARTUP_FALLBACK_MS: u64 = 3_000;
const STARTUP_PENDING: u8 = 0;
const STARTUP_SHOWING: u8 = 1;
const STARTUP_READY: u8 = 2;

static MAIN_STARTUP_STATE: AtomicU8 = AtomicU8::new(STARTUP_PENDING);

#[derive(Clone, Copy, Debug, PartialEq)]
struct PhysicalRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl PhysicalRect {
    fn width(self) -> u32 {
        self.right.saturating_sub(self.left) as u32
    }

    fn height(self) -> u32 {
        self.bottom.saturating_sub(self.top) as u32
    }

    fn intersects(self, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> bool {
        let right = position
            .x
            .saturating_add(size.width.min(i32::MAX as u32) as i32);
        let bottom = position
            .y
            .saturating_add(size.height.min(i32::MAX as u32) as i32);
        position.x < self.right
            && right > self.left
            && position.y < self.bottom
            && bottom > self.top
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
struct SavedWindowState {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
    #[serde(default)]
    prev_x: i32,
    #[serde(default)]
    prev_y: i32,
    #[serde(default)]
    maximized: bool,
}

pub(crate) fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_window_state::Builder::default()
        .with_filename(WINDOW_STATE_FILENAME)
        .with_state_flags(window_state_flags())
        .with_filter(|label| label == MAIN_WINDOW_LABEL)
        .skip_initial_state(MAIN_WINDOW_LABEL)
        .build()
}

pub(crate) fn prepare_main_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Ok(());
    };

    let monitor_rects = monitor_rects(&window)?;
    let saved_state = read_saved_main_window_state(app.handle());
    let can_restore = saved_state
        .as_ref()
        .is_some_and(|state| saved_state_is_visible(*state, &monitor_rects));

    if can_restore {
        window.restore_state(window_state_flags())?;
    } else {
        place_first_run_window(&window)?;
    }

    if window.is_minimized().unwrap_or(false) {
        window.unminimize()?;
    }
    Ok(())
}

pub(crate) fn main_window_startup_pending() -> bool {
    MAIN_STARTUP_STATE.load(Ordering::SeqCst) != STARTUP_READY
}

fn claim_startup_show(state: &AtomicU8) -> bool {
    state
        .compare_exchange(
            STARTUP_PENDING,
            STARTUP_SHOWING,
            Ordering::SeqCst,
            Ordering::SeqCst,
        )
        .is_ok()
}

fn finish_startup_show(state: &AtomicU8, succeeded: bool) {
    state.store(
        if succeeded {
            STARTUP_READY
        } else {
            STARTUP_PENDING
        },
        Ordering::SeqCst,
    );
}

fn show_prepared_main_window(app: &AppHandle) -> Result<(), String> {
    if !claim_startup_show(&MAIN_STARTUP_STATE) {
        return Ok(());
    }

    let result = (|| {
        let main = app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .ok_or_else(|| "Daymark main window is unavailable.".to_string())?;
        main.unminimize().map_err(|error| error.to_string())?;
        main.show().map_err(|error| error.to_string())?;
        hide_quick_capture_windows(app);
        set_quick_capture_state(QuickCaptureState::MainVisible);
        main.set_focus().map_err(|error| error.to_string())
    })();

    finish_startup_show(&MAIN_STARTUP_STATE, result.is_ok());
    result
}

#[tauri::command]
pub(crate) fn main_window_frontend_ready(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<(), String> {
    ensure_main_window(&window)?;
    show_prepared_main_window(&app)
}

pub(crate) fn schedule_main_window_show_fallback(app: AppHandle) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(MAIN_STARTUP_FALLBACK_MS));
        if !main_window_startup_pending() {
            return;
        }

        let main_thread_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = show_prepared_main_window(&main_thread_app) {
                eprintln!("failed to show main window after frontend-ready timeout: {error}");
            }
        });
    });
}

pub(crate) fn save_main_window_state(app: &tauri::AppHandle) {
    let _ = app.save_window_state(window_state_flags());
}

fn window_state_flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

fn read_saved_main_window_state(app: &tauri::AppHandle) -> Option<SavedWindowState> {
    let path = app.path().app_config_dir().ok()?.join(app.filename());
    let contents = std::fs::read_to_string(path).ok()?;
    let states = serde_json::from_str::<HashMap<String, SavedWindowState>>(&contents).ok()?;
    states.get(MAIN_WINDOW_LABEL).copied()
}

fn saved_state_is_visible(state: SavedWindowState, monitors: &[PhysicalRect]) -> bool {
    if state.width == 0 || state.height == 0 {
        return false;
    }
    let position = if state.maximized {
        PhysicalPosition::new(state.prev_x, state.prev_y)
    } else {
        PhysicalPosition::new(state.x, state.y)
    };
    let size = PhysicalSize::new(state.width, state.height);
    monitors
        .iter()
        .any(|monitor| monitor.intersects(position, size))
}

fn place_first_run_window(window: &WebviewWindow) -> tauri::Result<()> {
    let Some((work_area, scale_factor)) =
        cursor_work_area(window).or_else(|| fallback_work_area(window))
    else {
        window.center()?;
        return Ok(());
    };
    let (size, position) = centered_window_geometry(work_area, scale_factor);
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize()?;
    }
    window.set_size(size)?;
    window.set_position(position)?;
    Ok(())
}

fn centered_window_geometry(
    work_area: PhysicalRect,
    scale_factor: f64,
) -> (PhysicalSize<u32>, PhysicalPosition<i32>) {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let width = constrained_dimension(work_area.width(), PREFERRED_WIDTH, MINIMUM_WIDTH, scale);
    let height = constrained_dimension(work_area.height(), PREFERRED_HEIGHT, MINIMUM_HEIGHT, scale);
    let x = work_area.left + (work_area.width().saturating_sub(width) / 2) as i32;
    let y = work_area.top + (work_area.height().saturating_sub(height) / 2) as i32;
    (
        PhysicalSize::new(width, height),
        PhysicalPosition::new(x, y),
    )
}

fn constrained_dimension(available: u32, preferred: f64, minimum: f64, scale: f64) -> u32 {
    let preferred = (preferred * scale).round().max(1.0) as u32;
    let minimum = (minimum * scale).round().max(1.0) as u32;
    let proportional = (available as f64 * WORK_AREA_RATIO).round().max(1.0) as u32;
    preferred
        .min(proportional.max(minimum))
        .min(available.max(1))
}

fn monitor_rects(window: &WebviewWindow) -> tauri::Result<Vec<PhysicalRect>> {
    Ok(window
        .available_monitors()?
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            PhysicalRect {
                left: position.x,
                top: position.y,
                right: position
                    .x
                    .saturating_add(size.width.min(i32::MAX as u32) as i32),
                bottom: position
                    .y
                    .saturating_add(size.height.min(i32::MAX as u32) as i32),
            }
        })
        .collect())
}

#[cfg(target_os = "windows")]
fn cursor_work_area(window: &WebviewWindow) -> Option<(PhysicalRect, f64)> {
    use std::mem::size_of;
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut cursor = POINT { x: 0, y: 0 };
    if unsafe { GetCursorPos(&mut cursor) } == 0 {
        return None;
    }
    let monitor_handle = unsafe { MonitorFromPoint(cursor, MONITOR_DEFAULTTONEAREST) };
    if monitor_handle.is_null() {
        return None;
    }
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        rcMonitor: Default::default(),
        rcWork: Default::default(),
        dwFlags: 0,
    };
    if unsafe { GetMonitorInfoW(monitor_handle, &mut info) } == 0 {
        return None;
    }
    let work_area = PhysicalRect {
        left: info.rcWork.left,
        top: info.rcWork.top,
        right: info.rcWork.right,
        bottom: info.rcWork.bottom,
    };
    let scale_factor = window
        .available_monitors()
        .ok()?
        .into_iter()
        .find(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            cursor.x >= position.x
                && cursor.y >= position.y
                && cursor.x
                    < position
                        .x
                        .saturating_add(size.width.min(i32::MAX as u32) as i32)
                && cursor.y
                    < position
                        .y
                        .saturating_add(size.height.min(i32::MAX as u32) as i32)
        })
        .map(|monitor| monitor.scale_factor())
        .unwrap_or_else(|| window.scale_factor().unwrap_or(1.0));
    Some((work_area, scale_factor))
}

#[cfg(not(target_os = "windows"))]
fn cursor_work_area(_window: &WebviewWindow) -> Option<(PhysicalRect, f64)> {
    None
}

fn fallback_work_area(window: &WebviewWindow) -> Option<(PhysicalRect, f64)> {
    let monitor = window.primary_monitor().ok().flatten()?;
    let position = monitor.position();
    let size = monitor.size();
    Some((
        PhysicalRect {
            left: position.x,
            top: position.y,
            right: position
                .x
                .saturating_add(size.width.min(i32::MAX as u32) as i32),
            bottom: position
                .y
                .saturating_add(size.height.min(i32::MAX as u32) as i32),
        },
        monitor.scale_factor(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centers_preferred_size_in_large_work_area() {
        let work = PhysicalRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1040,
        };
        let (size, position) = centered_window_geometry(work, 1.0);
        assert_eq!(size, PhysicalSize::new(1280, 820));
        assert_eq!(position, PhysicalPosition::new(320, 110));
    }

    #[test]
    fn respects_scale_factor_and_work_area_limit() {
        let work = PhysicalRect {
            left: 1920,
            top: 0,
            right: 4480,
            bottom: 1400,
        };
        let (size, position) = centered_window_geometry(work, 1.5);
        assert_eq!(size, PhysicalSize::new(1920, 1230));
        assert_eq!(position, PhysicalPosition::new(2240, 85));
    }

    #[test]
    fn keeps_small_work_area_visible() {
        let work = PhysicalRect {
            left: 0,
            top: 0,
            right: 1366,
            bottom: 728,
        };
        let (size, position) = centered_window_geometry(work, 1.0);
        assert_eq!(size, PhysicalSize::new(1202, 720));
        assert_eq!(position, PhysicalPosition::new(82, 4));
    }

    #[test]
    fn rejects_saved_state_outside_available_monitors() {
        let monitors = [PhysicalRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        }];
        let state = SavedWindowState {
            width: 1280,
            height: 820,
            x: 3000,
            y: 120,
            prev_x: 3000,
            prev_y: 120,
            maximized: false,
        };
        assert!(!saved_state_is_visible(state, &monitors));
    }

    #[test]
    fn accepts_saved_state_with_partial_monitor_intersection() {
        let monitors = [PhysicalRect {
            left: -1920,
            top: 0,
            right: 0,
            bottom: 1080,
        }];
        let state = SavedWindowState {
            width: 1280,
            height: 820,
            x: -100,
            y: 80,
            prev_x: -100,
            prev_y: 80,
            maximized: false,
        };
        assert!(saved_state_is_visible(state, &monitors));
    }

    #[test]
    fn validates_maximized_state_from_previous_normal_position() {
        let monitors = [PhysicalRect {
            left: 0,
            top: 0,
            right: 1920,
            bottom: 1080,
        }];
        let state = SavedWindowState {
            width: 1280,
            height: 820,
            x: 3000,
            y: 0,
            prev_x: 240,
            prev_y: 100,
            maximized: true,
        };
        assert!(saved_state_is_visible(state, &monitors));
    }

    #[test]
    fn startup_show_claim_is_idempotent_and_retryable_after_failure() {
        let state = AtomicU8::new(STARTUP_PENDING);
        assert!(claim_startup_show(&state));
        assert!(!claim_startup_show(&state));

        finish_startup_show(&state, false);
        assert!(claim_startup_show(&state));

        finish_startup_show(&state, true);
        assert_eq!(state.load(Ordering::SeqCst), STARTUP_READY);
        assert!(!claim_startup_show(&state));
    }
}
