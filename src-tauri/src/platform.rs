use crate::fractal_adapter::{validated_page_target, FractalCommandError, FractalResult};
use std::{path::PathBuf, process::Command};

#[tauri::command(async)]
pub(crate) fn fractal_reveal_page(
    project_root: String,
    page_path: Option<String>,
) -> FractalResult<()> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|error| FractalCommandError {
            code: fractal::FractalErrorCode::Io,
            message: format!("Could not open project: {error}"),
        })?;
    fractal::Project::open(&root)?;
    let target = match page_path {
        Some(path) => validated_page_target(&root, &path).map_err(FractalCommandError::from)?,
        None => root,
    };
    if !target.exists() {
        return Err(FractalCommandError {
            code: fractal::FractalErrorCode::NotFound,
            message: format!(
                "Could not reveal {} because it does not exist.",
                target.display()
            ),
        });
    }
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(format!("/select,{}", target.display()));
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R").arg(&target);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(target.parent().unwrap_or(&target));
        command
    };
    command.spawn().map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not open the file manager: {error}"),
    })?;
    Ok(())
}

fn safe_external_url(href: &str) -> FractalResult<String> {
    let url = reqwest::Url::parse(href.trim()).map_err(|_| FractalCommandError {
        code: fractal::FractalErrorCode::InvalidInput,
        message: "Choose a complete external URL.".into(),
    })?;
    if !matches!(url.scheme(), "http" | "https" | "mailto" | "tel") {
        return Err(FractalCommandError {
            code: fractal::FractalErrorCode::InvalidInput,
            message: "That URL scheme is not allowed.".into(),
        });
    }
    Ok(url.to_string())
}

#[tauri::command(async)]
pub(crate) fn fractal_open_external(href: String) -> FractalResult<()> {
    let href = safe_external_url(&href)?;
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32");
        command.arg("url.dll,FileProtocolHandler").arg(&href);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(&href);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(&href);
        command
    };
    command.spawn().map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not open the external link: {error}"),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::safe_external_url;

    #[test]
    fn external_url_validation_separates_safe_urls_from_native_paths() {
        assert_eq!(
            safe_external_url("https://example.com").unwrap(),
            "https://example.com/"
        );
        assert_eq!(
            safe_external_url("mailto:notes@example.com").unwrap(),
            "mailto:notes@example.com"
        );
        assert!(safe_external_url("missing.fractal.html").is_err());
        assert!(safe_external_url("javascript:alert(1)").is_err());
    }
}
