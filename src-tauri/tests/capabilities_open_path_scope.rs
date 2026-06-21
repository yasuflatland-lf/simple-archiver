//! Guard: the `opener:allow-open-path` grant must carry a non-empty path scope.
//!
//! The opener plugin's `open_path` command (used by the Ledger's "Open folder"
//! button via `lib/reveal.ts`) is scope-checked: `is_path_allowed` returns false
//! whenever the allowed path scope is empty, so the call is rejected at runtime
//! with `ForbiddenPath` ("Not allowed to open path ..."). A bare-string grant
//! (`"opener:allow-open-path"`) only enables the command "without any
//! pre-configured scope", so it leaves that scope empty and breaks the button.
//!
//! This differs from `reveal_item_in_dir` (the per-row Reveal action), which the
//! plugin runs without any scope check — which is why Reveal worked while
//! "Open folder" did not.
//!
//! The fix is to grant `opener:allow-open-path` in object form with a path
//! `allow` list. This test fails on the bare-string form and passes once a
//! non-empty path scope is present.

use serde_json::Value;

const CAPABILITY: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/capabilities/default.json"
));

#[test]
fn open_path_grant_carries_a_non_empty_path_scope() {
    let capability: Value =
        serde_json::from_str(CAPABILITY).expect("capabilities/default.json is valid JSON");

    let permissions = capability["permissions"]
        .as_array()
        .expect("capability has a `permissions` array");

    let open_path_is_scoped = permissions.iter().any(|permission| {
        let is_open_path =
            permission.get("identifier").and_then(Value::as_str) == Some("opener:allow-open-path");

        let has_path_scope = permission
            .get("allow")
            .and_then(Value::as_array)
            .is_some_and(|entries| {
                entries.iter().any(|entry| {
                    entry
                        .get("path")
                        .and_then(Value::as_str)
                        .is_some_and(|path| !path.is_empty())
                })
            });

        is_open_path && has_path_scope
    });

    assert!(
        open_path_is_scoped,
        "opener:allow-open-path must be granted as an object with a non-empty `allow` path \
         scope; a bare-string grant leaves the scope empty and the opener plugin rejects \
         open_path with \"Not allowed to open path ...\""
    );
}
