// 在 release 模式下隱藏 Windows console
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    auth_2fa_lib::run()
}
