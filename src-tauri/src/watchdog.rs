use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::TryLockError;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::config;
use crate::state::{now_ms, AppState};

const RENDERER_TIMEOUT_MS: u64 = 20_000;
const MAIN_TIMEOUT_MS: u64 = 120_000;
const STARTUP_GRACE_MS: u64 = 30_000;
const CHECK_INTERVAL: Duration = Duration::from_secs(3);
const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW_MS: u64 = 10 * 60 * 1000;

static MAIN_HEARTBEAT_MS: AtomicU64 = AtomicU64::new(0);
static RESTARTING: AtomicBool = AtomicBool::new(false);

fn clean_marker_path(pid: u32) -> PathBuf {
    config::config_dir().join(format!(".watchdog-clean-{pid}"))
}

fn restart_log_path() -> PathBuf {
    config::config_dir().join(".watchdog-restarts")
}

fn watchdog_log_path() -> PathBuf {
    config::config_dir().join("watchdog.log")
}

fn append_log(message: &str) {
    let path = watchdog_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{} {}", now_ms(), message);
    }
}

pub fn mark_clean_exit() {
    let path = clean_marker_path(std::process::id());
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::write(path, b"clean");
}

fn cleanup_old_clean_markers() {
    let dir = config::config_dir();
    let current = std::process::id();
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some(pid_text) = name.strip_prefix(".watchdog-clean-") else {
            continue;
        };
        if pid_text.parse::<u32>().ok() == Some(current) {
            continue;
        }
        let old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .map(|age| age.as_secs() > 3600)
            .unwrap_or(false);
        if old {
            let _ = fs::remove_file(entry.path());
        }
    }
}

pub fn start(app: AppHandle) {
    let _ = fs::remove_file(clean_marker_path(std::process::id()));
    cleanup_old_clean_markers();
    MAIN_HEARTBEAT_MS.store(now_ms(), Ordering::Relaxed);
    install_signal_cleanup();

    if config::is_packaged() {
        spawn_parent_monitor(&app);
    }

    let heartbeat_app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            let now = now_ms();
            let handle = heartbeat_app.clone();
            let _ = handle.run_on_main_thread(move || {
                MAIN_HEARTBEAT_MS.store(now, Ordering::Relaxed);
            });
        }
    });

    thread::spawn(move || monitor(app));
}

fn install_signal_cleanup() {
    tauri::async_runtime::spawn(async move {
        #[cfg(unix)]
        {
            use tokio::signal::unix::{signal, SignalKind};

            let mut interrupt = match signal(SignalKind::interrupt()) {
                Ok(signal) => signal,
                Err(_) => return,
            };
            let mut terminate = match signal(SignalKind::terminate()) {
                Ok(signal) => signal,
                Err(_) => return,
            };
            tokio::select! {
                _ = interrupt.recv() => {}
                _ = terminate.recv() => {}
            }
        }

        #[cfg(not(unix))]
        {
            let _ = tokio::signal::ctrl_c().await;
        }

        mark_clean_exit();
        std::process::exit(0);
    });
}

fn monitor(app: AppHandle) {
    let started = now_ms();
    let mut lock_wait_since = 0u64;

    loop {
        thread::sleep(CHECK_INTERVAL);
        if RESTARTING.load(Ordering::Relaxed) {
            return;
        }

        let now = now_ms();
        if now < started.saturating_add(STARTUP_GRACE_MS) {
            continue;
        }

        let Some(state) = app.try_state::<AppState>() else {
            continue;
        };
        if state.is_locked() {
            lock_wait_since = 0;
            continue;
        }

        let runtime = match state.runtime.try_lock() {
            Ok(runtime) => runtime,
            Err(TryLockError::WouldBlock) => {
                if lock_wait_since == 0 {
                    lock_wait_since = now;
                } else if now.saturating_sub(lock_wait_since) > MAIN_TIMEOUT_MS {
                    force_restart(&app, "runtime state lock stuck");
                    return;
                }
                continue;
            }
            Err(TryLockError::Poisoned(_)) => {
                force_restart(&app, "runtime state lock poisoned");
                return;
            }
        };
        lock_wait_since = 0;

        if runtime.quitting {
            return;
        }

        // Native modal dialogs can block the main event loop while open.
        if runtime.dialog_count == 0 {
            let main_beat = MAIN_HEARTBEAT_MS.load(Ordering::Relaxed);
            if main_beat == 0 || now.saturating_sub(main_beat) > MAIN_TIMEOUT_MS {
                drop(runtime);
                force_restart(&app, "main event loop unresponsive");
                return;
            }
        }

        let mut stale_renderer = None;
        for (id, entry) in &runtime.windows {
            if !entry.running {
                continue;
            }
            let label = crate::windows::window_label(id);
            let beat = runtime
                .renderer_heartbeats
                .get(&label)
                .copied()
                .unwrap_or(0);
            if beat == 0 || now.saturating_sub(beat) > RENDERER_TIMEOUT_MS {
                stale_renderer = Some(label);
                break;
            }
        }

        if let Some(label) = stale_renderer {
            drop(runtime);
            force_restart(&app, &format!("renderer heartbeat stopped for '{label}'"));
            return;
        }
    }
}

pub fn force_restart(app: &AppHandle, reason: &str) {
    if RESTARTING.swap(true, Ordering::SeqCst) {
        return;
    }

    append_log(&format!("restarting: {reason}"));
    crate::single_instance::release();

    let args: Vec<String> = std::env::args().collect();
    #[cfg(debug_assertions)]
    let mut launched = crate::autostart::spawn_dev_restart_quiet(app);
    #[cfg(not(debug_assertions))]
    let mut launched = false;

    if !launched {
        let executable = relaunch_executable();
        launched = crate::autostart::spawn_delayed_restart(&executable, &args).is_ok();
    }

    if launched {
        mark_clean_exit();
    } else {
        append_log("failed to launch replacement instance");
    }

    force_exit();
}

fn force_exit() -> ! {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, TerminateProcess};
        unsafe {
            TerminateProcess(GetCurrentProcess(), 0);
        }
    }
    std::process::exit(0);
}

fn relaunch_executable() -> PathBuf {
    std::env::var("APPIMAGE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            std::env::current_exe().unwrap_or_else(|_| PathBuf::from(config::APP_NAME_LC))
        })
}

fn spawn_parent_monitor(app: &AppHandle) {
    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(err) => {
            append_log(&format!("cannot locate executable for watchdog: {err}"));
            return;
        }
    };

    let mut command = Command::new(executable);
    command
        .arg("--watchdog")
        .arg(std::process::id().to_string());
    for arg in std::env::args().skip(1) {
        command.arg(arg);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);

    if let Err(err) = command.spawn() {
        append_log(&format!("failed to spawn parent monitor: {err}"));
    } else {
        let _ = app;
    }
}

fn detach(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        command.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
}

pub fn run_external_if_requested() -> bool {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("--watchdog") {
        return false;
    }

    let Some(pid) = args.next().and_then(|value| value.parse::<u32>().ok()) else {
        return true;
    };
    let relaunch_args: Vec<String> = args.collect();
    run_external(pid, relaunch_args);
    true
}

fn run_external(parent_pid: u32, relaunch_args: Vec<String>) {
    wait_for_parent(parent_pid);

    let marker = clean_marker_path(parent_pid);
    if marker.exists() {
        let _ = fs::remove_file(marker);
        return;
    }

    if restart_limit_reached() {
        append_log("crash restart limit reached; not relaunching");
        return;
    }

    append_log("parent exited unexpectedly; relaunching");
    if let Err(err) = relaunch(&relaunch_args) {
        append_log(&format!("failed to relaunch app: {err}"));
    }
}

fn relaunch(args: &[String]) -> std::io::Result<()> {
    let mut command = Command::new(relaunch_executable());
    command.args(args);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    detach(&mut command);
    command.spawn()?;
    Ok(())
}

fn restart_limit_reached() -> bool {
    let path = restart_log_path();
    let now = now_ms();
    let mut recent = Vec::new();

    if let Ok(text) = fs::read_to_string(&path) {
        for line in text.lines() {
            if let Ok(timestamp) = line.trim().parse::<u64>() {
                if now.saturating_sub(timestamp) < RESTART_WINDOW_MS {
                    recent.push(timestamp);
                }
            }
        }
    }

    if recent.len() >= MAX_RESTARTS {
        return true;
    }

    recent.push(now);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let text = recent
        .iter()
        .map(|timestamp| timestamp.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    let _ = fs::write(path, format!("{text}\n"));
    false
}

#[cfg(unix)]
fn wait_for_parent(pid: u32) {
    loop {
        let result = unsafe { libc::kill(pid as i32, 0) };
        let alive =
            result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
        if !alive {
            return;
        }
        thread::sleep(Duration::from_secs(1));
    }
}

#[cfg(target_os = "windows")]
fn wait_for_parent(pid: u32) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE,
    };

    let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
    if handle.is_null() {
        return;
    }
    unsafe {
        WaitForSingleObject(handle, INFINITE);
        CloseHandle(handle);
    }
}

#[cfg(not(any(unix, target_os = "windows")))]
fn wait_for_parent(pid: u32) {
    while pid != 0 {
        thread::sleep(Duration::from_secs(1));
    }
}
