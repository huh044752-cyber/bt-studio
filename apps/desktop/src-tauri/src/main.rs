// Windows 下隐藏控制台窗口(release)。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    bt_studio_lib::run();
}
