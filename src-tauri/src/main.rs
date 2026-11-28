#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if ribbons_tauri_lib::watchdog::run_external_if_requested() {
        return;
    }
    ribbons_tauri_lib::run();
}
