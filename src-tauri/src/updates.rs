//! New-version checks (Battle Maps, Open20 Essentials) and links to open20.app.
//!
//! The frontend asks for each product's latest release version (GitHub's
//! public API: the same releases the downloads on open20.app point to). Any
//! failure (offline, rate limit) just means "nothing to say": the check must
//! never bother the user.

use std::time::Duration;

use serde::Deserialize;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

/// The latest-release API of each product the app checks.
fn latest_release_url(product: &str) -> Option<&'static str> {
    match product {
        "battle-maps" => {
            Some("https://api.github.com/repos/open20-rpg/open20-battlemaps/releases/latest")
        }
        "essentials" => {
            Some("https://api.github.com/repos/open20-rpg/open20-essentials/releases/latest")
        }
        _ => None,
    }
}

/// Pages of open20.app the app links to (nothing else can be opened).
fn page_url(page: &str) -> Option<&'static str> {
    match page {
        "battle-maps" => Some("https://open20.app/battle-maps"),
        "essentials" => Some("https://open20.app/essentials"),
        _ => None,
    }
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
}

/// `v1.2.3` → `1.2.3`.
fn version_of(tag: &str) -> String {
    tag.trim().trim_start_matches(['v', 'V']).to_string()
}

fn fetch_latest(url: &str) -> Option<String> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(8)))
        .build()
        .into();
    let mut res = agent
        .get(url)
        // GitHub's API refuses requests without a User-Agent.
        .header("User-Agent", "open20-battle-maps")
        .header("Accept", "application/vnd.github+json")
        .call()
        .ok()?;
    let text = res.body_mut().read_to_string().ok()?;
    let release: Release = serde_json::from_str(&text).ok()?;
    Some(version_of(&release.tag_name))
}

/// The latest published version of `product` ("battle-maps", "essentials"),
/// or None when it can't be known now.
#[tauri::command]
pub async fn latest_version(product: String) -> Option<String> {
    let url = latest_release_url(&product)?;
    tauri::async_runtime::spawn_blocking(move || fetch_latest(url))
        .await
        .ok()
        .flatten()
}

/// Open a page of open20.app in the system browser.
#[tauri::command]
pub fn open_open20_page(app: AppHandle, page: String) -> Result<(), String> {
    let url = page_url(&page).ok_or_else(|| format!("unknown page '{page}'"))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_versions_from_tags() {
        assert_eq!(version_of("v0.3.53"), "0.3.53");
        assert_eq!(version_of(" 1.0.0 "), "1.0.0");
        let r: Release = serde_json::from_str(r#"{"tag_name":"v0.4.0","name":"x"}"#).unwrap();
        assert_eq!(version_of(&r.tag_name), "0.4.0");
    }

    #[test]
    fn checks_only_known_products() {
        assert!(latest_release_url("battle-maps").is_some_and(|u| u.contains("open20-battlemaps")));
        assert!(latest_release_url("essentials").is_some_and(|u| u.contains("open20-essentials")));
        assert_eq!(latest_release_url("other"), None);
    }

    #[test]
    fn opens_only_known_pages() {
        assert_eq!(
            page_url("battle-maps"),
            Some("https://open20.app/battle-maps")
        );
        assert_eq!(
            page_url("essentials"),
            Some("https://open20.app/essentials")
        );
        assert_eq!(page_url("https://evil.example"), None);
    }
}
