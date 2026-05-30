// Generates the LALRPOP parser from `src/domain/template.lalrpop` into OUT_DIR.
fn main() {
    lalrpop::process_root().unwrap();

    // `unrar_sys` (bundled UnRAR C++) references Windows advapi32 APIs (registry,
    // process-token/SID, legacy CryptoAPI) on the MSVC target but does not emit the
    // link directive itself, so linking any artifact that pulls in `unrar` fails with
    // LNK2019 unresolved `__imp_Reg*` / `OpenProcessToken` / `Crypt*` / `SetFileSecurityW`.
    // Link advapi32 for Windows targets so the core test binary and the Tauri app both link.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }
}
