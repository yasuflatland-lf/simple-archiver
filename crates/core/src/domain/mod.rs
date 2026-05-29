//! Domain layer — pure business logic, no IO.
//! スキャフォルドのプレースホルダ。実際の値オブジェクト(NamingRule 等)は PR3 (issue #3) で追加し、
//! その際 `layer_name` は削除する。

/// テストハーネスが domain 層に対して動作することを示すスキャフォルドマーカー。
pub fn layer_name() -> &'static str {
    "domain"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layer_name_is_domain() {
        assert_eq!(layer_name(), "domain");
    }
}
