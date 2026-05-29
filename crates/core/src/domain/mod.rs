//! Domain layer — pure business logic, no IO.
//! Scaffold placeholder. Real value objects (e.g. NamingRule) will be added in PR3 (issue #3),
//! at which point `layer_name` will be removed.

/// Scaffold marker to verify that the test harness operates against the domain layer.
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
