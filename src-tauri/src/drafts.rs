use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

use crate::fractal_adapter::{FractalCommandError, FractalResult};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageDraft {
    version: u32,
    project_root: String,
    page_path: String,
    source: String,
    base_source_hash: String,
    updated_at: String,
}

fn draft_dir(app: &AppHandle) -> FractalResult<PathBuf> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("drafts"))
        .map_err(|error| {
            FractalCommandError::io(format!("Could not resolve Amanite draft storage: {error}"))
        })
}

fn digest(root: &str, page: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(root.as_bytes());
    hash.update([0]);
    hash.update(page.as_bytes());
    format!("{:x}.json", hash.finalize())
}

fn draft_path(directory: &Path, root: &str, page: &str) -> PathBuf {
    directory.join(digest(root, page))
}

fn read_record(path: &Path) -> FractalResult<PageDraft> {
    let bytes = fs::read(path)
        .map_err(|error| FractalCommandError::io(format!("Could not read draft: {error}")))?;
    serde_json::from_slice(&bytes)
        .map_err(|error| FractalCommandError::json(format!("Could not parse draft: {error}")))
}

async fn run_filesystem_task<T, F>(description: &'static str, task: F) -> FractalResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> FractalResult<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| {
            FractalCommandError::io(format!("Could not complete draft {description}: {error}"))
        })?
}

fn list_drafts(app: AppHandle, project_root: Option<String>) -> FractalResult<Vec<PageDraft>> {
    let directory = draft_dir(&app)?;
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => {
            return Err(FractalCommandError::io(format!(
                "Could not list drafts: {error}"
            )))
        }
    };
    let mut drafts = Vec::new();
    for entry in entries {
        let entry = entry
            .map_err(|error| FractalCommandError::io(format!("Could not list drafts: {error}")))?;
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let draft = read_record(&entry.path())?;
        if project_root
            .as_deref()
            .is_none_or(|root| draft.project_root == root)
        {
            drafts.push(draft);
        }
    }
    drafts.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(drafts)
}

#[tauri::command]
pub(crate) async fn fractal_list_drafts(
    app: AppHandle,
    project_root: Option<String>,
) -> FractalResult<Vec<PageDraft>> {
    run_filesystem_task("listing", move || list_drafts(app, project_root)).await
}

fn read_draft(
    app: AppHandle,
    project_root: String,
    page_path: String,
) -> FractalResult<Option<PageDraft>> {
    let path = draft_path(&draft_dir(&app)?, &project_root, &page_path);
    match read_record(&path) {
        Ok(draft) if draft.project_root == project_root && draft.page_path == page_path => {
            Ok(Some(draft))
        }
        Ok(_) => Err(FractalCommandError::invalid_input(
            "Draft identity does not match its filename.",
        )),
        Err(_error) if !path.exists() => Ok(None),
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn fractal_read_draft(
    app: AppHandle,
    project_root: String,
    page_path: String,
) -> FractalResult<Option<PageDraft>> {
    run_filesystem_task("read", move || read_draft(app, project_root, page_path)).await
}

fn write_draft(app: &AppHandle, draft: PageDraft) -> FractalResult<()> {
    if draft.version != 1
        || draft.project_root.trim().is_empty()
        || draft.page_path.trim().is_empty()
    {
        return Err(FractalCommandError::invalid_input(
            "Draft record is invalid.",
        ));
    }
    let directory = draft_dir(app)?;
    fs::create_dir_all(&directory).map_err(|error| {
        FractalCommandError::io(format!("Could not create draft storage: {error}"))
    })?;
    let target = draft_path(&directory, &draft.project_root, &draft.page_path);
    let temporary = target.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(&draft)
        .map_err(|error| FractalCommandError::json(format!("Could not encode draft: {error}")))?;
    let mut file = fs::File::create(&temporary)
        .map_err(|error| FractalCommandError::io(format!("Could not create draft: {error}")))?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| FractalCommandError::io(format!("Could not commit draft: {error}")))?;
    fs::rename(&temporary, &target)
        .map_err(|error| FractalCommandError::io(format!("Could not replace draft: {error}")))?;
    Ok(())
}

#[tauri::command]
pub(crate) async fn fractal_write_draft(app: AppHandle, draft: PageDraft) -> FractalResult<()> {
    run_filesystem_task("write", move || write_draft(&app, draft)).await
}

fn move_draft(app: AppHandle, project_root: String, from: String, to: String) -> FractalResult<()> {
    let directory = draft_dir(&app)?;
    let source = draft_path(&directory, &project_root, &from);
    if !source.exists() {
        return Ok(());
    }
    let mut draft = read_record(&source)?;
    draft.page_path = to.clone();
    write_draft(&app, draft)?;
    fs::remove_file(source)
        .map_err(|error| FractalCommandError::io(format!("Could not remove moved draft: {error}")))
}

#[tauri::command]
pub(crate) async fn fractal_move_draft(
    app: AppHandle,
    project_root: String,
    from: String,
    to: String,
) -> FractalResult<()> {
    run_filesystem_task("move", move || move_draft(app, project_root, from, to)).await
}

fn delete_draft(app: AppHandle, project_root: String, page_path: String) -> FractalResult<()> {
    let path = draft_path(&draft_dir(&app)?, &project_root, &page_path);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(FractalCommandError::io(format!(
            "Could not delete draft: {error}"
        ))),
    }
}

#[tauri::command]
pub(crate) async fn fractal_delete_draft(
    app: AppHandle,
    project_root: String,
    page_path: String,
) -> FractalResult<()> {
    run_filesystem_task("deletion", move || {
        delete_draft(app, project_root, page_path)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::digest;

    #[test]
    fn draft_names_do_not_expose_paths() {
        let name = digest("/secret/project", "notes/page.fractal.html");
        assert_eq!(name.len(), 69);
        assert!(!name.contains("secret"));
        assert_eq!(name, digest("/secret/project", "notes/page.fractal.html"));
    }

    #[test]
    fn filesystem_commands_do_not_run_on_the_ui_thread() {
        let source = include_str!("drafts.rs");
        for command in [
            "fractal_list_drafts",
            "fractal_read_draft",
            "fractal_write_draft",
            "fractal_move_draft",
            "fractal_delete_draft",
        ] {
            assert!(
                source.contains(&format!("pub(crate) async fn {command}")),
                "{command} must remain asynchronous"
            );
        }
        assert!(source.contains("tauri::async_runtime::spawn_blocking(task)"));
    }
}
