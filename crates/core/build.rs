// Generates the LALRPOP parser from `src/domain/template.lalrpop` into OUT_DIR.
fn main() {
    lalrpop::process_root().unwrap();
}
