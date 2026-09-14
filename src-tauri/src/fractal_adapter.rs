use crate::catalog;
use crate::project_session::{ProjectSessionStore, SessionMetadata};
use serde::Serialize;
use std::sync::OnceLock;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalNativeDocumentParts {
    title: String,
    title_hash: String,
    content_html: String,
    content_hash: String,
    style_css: String,
    style_hash: String,
    metadata_html: String,
    metadata_hash: String,
    source_hash: String,
}

impl From<fractal::NativeDocumentParts> for FractalNativeDocumentParts {
    fn from(parts: fractal::NativeDocumentParts) -> Self {
        Self {
            title: parts.title,
            title_hash: parts.title_hash,
            content_html: parts.content_html,
            content_hash: parts.content_hash,
            style_css: parts.style_css,
            style_hash: parts.style_hash,
            metadata_html: parts.metadata_html,
            metadata_hash: parts.metadata_hash,
            source_hash: parts.source_hash,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalProject {
    name: String,
    version: u32,
    root_path: String,
    pages: Vec<FractalPage>,
    folders: Vec<fractal::Folder>,
    active_page_path: Option<String>,
    active_page_source: Option<String>,
    active_page_links: Vec<fractal::Link>,
    active_page_backlinks: Vec<fractal::Backlink>,
    active_page_content_hash: Option<String>,
    active_page_native_document_parts: Option<FractalNativeDocumentParts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_freshness: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_generation: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalLoadedPage {
    path: String,
    source: String,
    links: Vec<fractal::Link>,
    backlinks: Vec<fractal::Backlink>,
    content_hash: String,
    native_document_parts: Option<FractalNativeDocumentParts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_freshness: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_generation: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalPage {
    path: String,
    content_hash: String,
    title: Option<String>,
    text: String,
    links: Vec<fractal::Link>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalSearchResult {
    path: String,
    title: Option<String>,
    snippet: String,
    catalog_version: u64,
    catalog_freshness: &'static str,
    session_generation: u64,
}

impl From<fractal::Page> for FractalPage {
    fn from(page: fractal::Page) -> Self {
        Self {
            path: page.path,
            content_hash: page.content_hash,
            title: page.title,
            text: page.text,
            links: page.links,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalProjectSummary {
    pub(crate) name: String,
    pub(crate) root_path: String,
    pub(crate) directory_name: String,
    pub(crate) inspection: fractal::ProjectInspection,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalProjectCatalog {
    root_path: String,
    projects: Vec<FractalProjectSummary>,
    issues: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalCommandResult {
    ok: bool,
    message: String,
    details: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalPageContentState {
    path: String,
    content_hash: Option<String>,
    native_document_hashes: Option<FractalNativeDocumentHashes>,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_version: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    catalog_freshness: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_generation: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalNativeDocumentHashes {
    title_hash: String,
    content_hash: String,
    style_hash: String,
    metadata_hash: String,
    source_hash: String,
}

impl From<&FractalNativeDocumentParts> for FractalNativeDocumentHashes {
    fn from(parts: &FractalNativeDocumentParts) -> Self {
        Self {
            title_hash: parts.title_hash.clone(),
            content_hash: parts.content_hash.clone(),
            style_hash: parts.style_hash.clone(),
            metadata_hash: parts.metadata_hash.clone(),
            source_hash: parts.source_hash.clone(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalHtmlExportReport {
    output: String,
    references: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FractalFolderHtmlExportReport {
    output: String,
    pages: Vec<String>,
    skipped: Vec<fractal::SkippedExportPage>,
    references: Vec<String>,
}

#[derive(Debug, Serialize)]
pub(crate) struct FractalCommandError {
    pub(crate) code: fractal::FractalErrorCode,
    pub(crate) message: String,
}

impl From<fractal::FractalError> for FractalCommandError {
    fn from(error: fractal::FractalError) -> Self {
        Self {
            code: error.code,
            message: error.message,
        }
    }
}

impl FractalCommandError {
    pub(crate) fn io(message: impl Into<String>) -> Self {
        Self {
            code: fractal::FractalErrorCode::Io,
            message: message.into(),
        }
    }
    pub(crate) fn json(message: impl Into<String>) -> Self {
        Self {
            code: fractal::FractalErrorCode::Json,
            message: message.into(),
        }
    }
    pub(crate) fn invalid_input(message: impl Into<String>) -> Self {
        Self {
            code: fractal::FractalErrorCode::InvalidInput,
            message: message.into(),
        }
    }
}

impl From<String> for FractalCommandError {
    fn from(message: String) -> Self {
        Self {
            code: fractal::FractalErrorCode::InvalidInput,
            message,
        }
    }
}

impl From<&str> for FractalCommandError {
    fn from(message: &str) -> Self {
        message.to_string().into()
    }
}

pub(crate) type FractalResult<T> = Result<T, FractalCommandError>;

static PROJECT_SESSIONS: OnceLock<ProjectSessionStore> = OnceLock::new();

fn project_sessions() -> &'static ProjectSessionStore {
    PROJECT_SESSIONS.get_or_init(ProjectSessionStore::default)
}

#[derive(Serialize)]
pub(crate) struct FractalMutationResult {
    project: FractalProject,
    receipt: fractal::MutationReceipt,
}

#[derive(Serialize)]
pub(crate) struct FractalMutationBatchResult {
    project: FractalProject,
    receipts: Vec<fractal::MutationReceipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure: Option<FractalCommandError>,
}

#[derive(Serialize)]
pub(crate) struct FractalRecoveryResult {
    project: Option<FractalProject>,
    report: fractal::RecoveryReport,
    inspection: fractal::ProjectInspection,
}

#[derive(Serialize)]
pub(crate) struct FractalRepairResult {
    project: FractalProject,
    report: fractal::RepairReport,
    inspection: fractal::ProjectInspection,
}

#[tauri::command]
pub(crate) async fn fractal_inspect_project(
    project_root: String,
) -> FractalResult<fractal::ProjectInspection> {
    tauri::async_runtime::spawn_blocking(move || Ok(fractal::Project::inspect(project_root)?))
        .await
        .map_err(|error| FractalCommandError::io(format!("Could not inspect project: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_recover_project(
    project_root: String,
) -> FractalResult<FractalRecoveryResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let report = fractal::Project::recover(&project_root)?;
        let inspection = fractal::Project::inspect(&project_root)?;
        let project = if inspection.openable {
            let root = project_root.clone();
            Some(
                project_sessions().with_refreshed(&root, |project, metadata| {
                    project_snapshot_with_metadata(project, None, metadata)
                })?,
            )
        } else {
            None
        };
        Ok(FractalRecoveryResult {
            project,
            report,
            inspection,
        })
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not recover project: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_repair_project(
    project_root: String,
) -> FractalResult<FractalRepairResult> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_mutation(&project_root, |project, metadata| {
            let report = project.repair()?;
            let snapshot = project_snapshot_with_metadata(project, None, metadata)?;
            let inspection = fractal::Project::inspect(&project_root)?;
            Ok(FractalRepairResult {
                project: snapshot,
                report,
                inspection,
            })
        })
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not repair project: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_recreate_page(
    project_root: String,
    page_path: String,
    source: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_mutation(&project_root, |project, metadata| {
            let draft = fractal::NativePageDraft::from_source(&source)?;
            let parent = relative_page_path(&page_path)
                .map_err(FractalCommandError::from)?
                .parent()
                .unwrap_or_else(|| Path::new(""))
                .to_path_buf();
            let destination = parent.join(format!(
                "{}.fractal.html",
                catalog::project_directory_name(&draft.title).map_err(FractalCommandError::from)?
            ));
            let receipt = project.recreate_page_from_source(&destination, &source)?;
            let created =
                created_page_path(&receipt).ok_or("Fractal did not report the recreated page.")?;
            mutation_result_with_metadata(project, Some(&created), receipt, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not recreate page: {error}")))?
}

fn project_snapshot(
    project: &fractal::Project,
    active_path: Option<&str>,
) -> FractalResult<FractalProject> {
    let root = project.root().to_path_buf();
    let pages = project
        .pages()
        .into_iter()
        .map(FractalPage::from)
        .collect::<Vec<_>>();
    let active_path = match active_path {
        Some(path) => Some(project.page(path)?.path),
        None => pages.first().map(|page| page.path.clone()),
    };
    let active_page_native_document_parts = active_path
        .as_deref()
        .and_then(|path| project.native_document_parts(path).ok())
        .map(Into::into);
    let (active_page_source, active_page_links, active_page_backlinks, active_page_content_hash) =
        match active_path.as_deref() {
            Some(path) => (
                Some(project.source(path)?),
                project.links(path)?,
                project.backlinks(path)?,
                Some(project.content_hash(path)?),
            ),
            None => (None, vec![], vec![], None),
        };

    Ok(FractalProject {
        name: project.manifest().name.clone(),
        version: project.manifest().version,
        root_path: root.to_string_lossy().into(),
        pages,
        folders: project.folders(),
        active_page_path: active_path,
        active_page_source,
        active_page_links,
        active_page_backlinks,
        active_page_content_hash,
        active_page_native_document_parts,
        catalog_version: None,
        catalog_freshness: None,
        session_generation: None,
    })
}

fn project_snapshot_with_metadata(
    project: &fractal::Project,
    active_path: Option<&str>,
    metadata: SessionMetadata,
) -> FractalResult<FractalProject> {
    let mut snapshot = project_snapshot(project, active_path)?;
    snapshot.catalog_version = Some(metadata.catalog_version);
    snapshot.catalog_freshness = Some(metadata.freshness.as_str());
    snapshot.session_generation = Some(metadata.generation);
    Ok(snapshot)
}

fn relative_folder_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value.trim().trim_matches('/'));
    if path.as_os_str().is_empty()
        || path.extension().is_some()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("Choose a folder name without an extension or parent path.".into());
    }
    Ok(path.to_path_buf())
}

pub(crate) fn relative_page_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value.trim());
    if path.as_os_str().is_empty()
        || !path
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
    {
        return Err("Choose a valid page inside this project.".into());
    }
    Ok(path.to_path_buf())
}

pub(crate) fn validated_page_target(
    project_root: &Path,
    page_path: &str,
) -> Result<PathBuf, String> {
    let pages_root = project_root
        .join("pages")
        .canonicalize()
        .map_err(|error| format!("Could not open project pages: {error}"))?;
    let target = pages_root
        .join(relative_page_path(page_path)?)
        .canonicalize()
        .map_err(|error| format!("Could not open {page_path}: {error}"))?;
    if !target.starts_with(&pages_root) {
        return Err("Choose a page inside this project.".into());
    }
    Ok(target)
}

fn page_path_from_project_path(path: &fractal::ProjectPath) -> Option<String> {
    path.as_str().strip_prefix("pages/").map(str::to_string)
}

fn created_page_path(receipt: &fractal::MutationReceipt) -> Option<String> {
    receipt.changes.iter().find_map(|change| match change {
        fractal::ProjectChange::Created {
            path,
            entry: fractal::ProjectEntryKind::File,
            ..
        } if path.as_str().ends_with(".fractal.html") => page_path_from_project_path(path),
        _ => None,
    })
}

fn page_path_after_receipt(
    page_path: Option<&str>,
    receipt: &fractal::MutationReceipt,
) -> Option<String> {
    let mut current = page_path.map(str::to_string)?;
    for change in &receipt.changes {
        match change {
            fractal::ProjectChange::Moved {
                from, to, entry, ..
            } => {
                let Some(from) = page_path_from_project_path(from) else {
                    continue;
                };
                let Some(to) = page_path_from_project_path(to) else {
                    continue;
                };
                match entry {
                    fractal::ProjectEntryKind::File if current == from => current = to,
                    fractal::ProjectEntryKind::Directory
                        if current == from || current.starts_with(&format!("{from}/")) =>
                    {
                        current = format!("{to}{}", &current[from.len()..]);
                    }
                    _ => {}
                }
            }
            fractal::ProjectChange::Deleted { path, entry, .. } => {
                let Some(deleted) = page_path_from_project_path(path) else {
                    continue;
                };
                if (*entry == fractal::ProjectEntryKind::File && current == deleted)
                    || (*entry == fractal::ProjectEntryKind::Directory
                        && (current == deleted || current.starts_with(&format!("{deleted}/"))))
                {
                    return None;
                }
            }
            _ => {}
        }
    }
    Some(current)
}

fn mutation_result_with_metadata(
    project: &fractal::Project,
    active_page_path: Option<&str>,
    receipt: fractal::MutationReceipt,
    metadata: SessionMetadata,
) -> FractalResult<FractalMutationResult> {
    let active_page_path = page_path_after_receipt(active_page_path, &receipt);
    Ok(FractalMutationResult {
        project: project_snapshot_with_metadata(project, active_page_path.as_deref(), metadata)?,
        receipt,
    })
}

pub(crate) fn fractal_list_projects_blocking(
    app: AppHandle,
) -> FractalResult<FractalProjectCatalog> {
    let root = catalog::projects_root(&app).map_err(FractalCommandError::from)?;
    let (projects, issues) =
        catalog::list_project_summaries(&root).map_err(FractalCommandError::from)?;
    Ok(FractalProjectCatalog {
        projects,
        issues,
        root_path: root.to_string_lossy().into(),
    })
}

#[tauri::command]
pub(crate) async fn fractal_list_projects(app: AppHandle) -> FractalResult<FractalProjectCatalog> {
    tauri::async_runtime::spawn_blocking(move || fractal_list_projects_blocking(app))
        .await
        .map_err(|error| FractalCommandError::io(format!("Could not list projects: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_create_project(
    app: AppHandle,
    project_name: String,
) -> FractalResult<FractalProject> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = catalog::projects_root(&app).map_err(FractalCommandError::from)?;
        fs::create_dir_all(&library).map_err(|error| FractalCommandError {
            code: fractal::FractalErrorCode::Io,
            message: format!("Could not create project library: {error}"),
        })?;
        let root = library.join(
            catalog::project_directory_name(&project_name).map_err(FractalCommandError::from)?,
        );
        fractal::Project::init(&root, project_name.trim())?;
        let root_string = root.to_string_lossy().into_owned();
        project_sessions().with_refreshed(&root_string, |project, metadata| {
            project_snapshot_with_metadata(project, None, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not create project: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_open_project(
    app: AppHandle,
    directory_name: String,
) -> FractalResult<FractalProject> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = catalog::selected_project_root(
            &catalog::projects_root(&app).map_err(FractalCommandError::from)?,
            &directory_name,
        )
        .map_err(FractalCommandError::from)?;
        let root_string = root.to_string_lossy().into_owned();
        project_sessions().with_refreshed(&root_string, |project, metadata| {
            project_snapshot_with_metadata(project, None, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not open project: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_open_project_path(
    project_root: String,
) -> FractalResult<FractalProject> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_refreshed(&project_root, |project, metadata| {
            project_snapshot_with_metadata(project, None, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not open project: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_open_page(
    project_root: String,
    page_path: String,
) -> FractalResult<FractalProject> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_cached(&project_root, |project, metadata| {
            project_snapshot_with_metadata(project, Some(&page_path), metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page open: {error}"),
    })?
}

#[tauri::command]
pub(crate) async fn fractal_read_page(
    project_root: String,
    page_path: String,
) -> FractalResult<FractalLoadedPage> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_cached(&project_root, |project, metadata| {
            let page = project.page(&page_path)?;
            let path = page.path.clone();
            let native_document_parts = project.native_document_parts(&path).ok().map(Into::into);
            Ok(FractalLoadedPage {
                path: path.clone(),
                source: project.source(&path)?,
                links: page.links,
                backlinks: project.backlinks(&path)?,
                content_hash: project.content_hash(&path)?,
                native_document_parts,
                catalog_version: Some(metadata.catalog_version),
                catalog_freshness: Some(metadata.freshness.as_str()),
                session_generation: Some(metadata.generation),
            })
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page read: {error}"),
    })?
}

#[tauri::command]
pub(crate) async fn fractal_set_page_title(
    project_root: String,
    page_path: String,
    title: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_mutation(&project_root, |project, metadata| {
            let receipt =
                project.set_page_title_if_unchanged(&page_path, &title, &expected_hash)?;
            mutation_result_with_metadata(project, Some(&page_path), receipt, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page title change: {error}"),
    })?
}

#[tauri::command]
pub(crate) async fn fractal_set_page_content(
    project_root: String,
    page_path: String,
    content_html: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_mutation(&project_root, |project, metadata| {
            let receipt = project.set_page_content(&page_path, &content_html, &expected_hash)?;
            mutation_result_with_metadata(project, Some(&page_path), receipt, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page content write: {error}"),
    })?
}

#[tauri::command]
pub(crate) async fn fractal_set_page_style(
    project_root: String,
    page_path: String,
    style_css: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_mutation(&project_root, |project, metadata| {
            let receipt = project.set_page_style(&page_path, &style_css, &expected_hash)?;
            mutation_result_with_metadata(project, Some(&page_path), receipt, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page style write: {error}"),
    })?
}

#[tauri::command]
pub(crate) async fn fractal_set_page_metadata(
    project_root: String,
    page_path: String,
    metadata_html: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_mutation(&project_root, |project, metadata| {
            let receipt = project.set_page_metadata(&page_path, &metadata_html, &expected_hash)?;
            mutation_result_with_metadata(project, Some(&page_path), receipt, metadata)
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page metadata write: {error}"),
    })?
}

pub(crate) fn fractal_repair_page_structure_blocking(
    project_root: String,
    page_path: String,
) -> FractalResult<FractalMutationResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let receipt = project.repair_page_structure(&page_path)?;
        mutation_result_with_metadata(project, Some(&page_path), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_repair_page_structure(
    project_root: String,
    page_path: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_repair_page_structure_blocking(project_root, page_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not repair page: {error}")))?
}

#[tauri::command]
pub(crate) async fn fractal_search_project(
    project_root: String,
    query: String,
) -> FractalResult<Vec<FractalSearchResult>> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_cached(&project_root, |project, metadata| {
            Ok(project
                .search(&query)
                .into_iter()
                .map(|result| FractalSearchResult {
                    path: result.path,
                    title: result.title,
                    snippet: result.snippet,
                    catalog_version: metadata.catalog_version,
                    catalog_freshness: metadata.freshness.as_str(),
                    session_generation: metadata.generation,
                })
                .collect())
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete project search: {error}"),
    })?
}

#[tauri::command]
pub(crate) async fn fractal_page_content_states(
    project_root: String,
    page_paths: Vec<String>,
) -> FractalResult<Vec<FractalPageContentState>> {
    tauri::async_runtime::spawn_blocking(move || {
        project_sessions().with_refreshed(&project_root, |project, metadata| {
            let pages = project
                .pages()
                .into_iter()
                .map(|page| (page.path.clone(), page))
                .collect::<std::collections::BTreeMap<_, _>>();
            page_paths
                .into_iter()
                .map(|path| {
                    relative_page_path(&path).map_err(FractalCommandError::from)?;
                    let page = pages.get(&path);
                    let native_document_hashes = page
                        .and_then(|_| project.native_document_parts(&path).ok())
                        .map(|parts| {
                            FractalNativeDocumentHashes::from(&FractalNativeDocumentParts::from(
                                parts,
                            ))
                        });
                    Ok(FractalPageContentState {
                        content_hash: page.map(|page| page.content_hash.clone()),
                        native_document_hashes,
                        path,
                        catalog_version: Some(metadata.catalog_version),
                        catalog_freshness: Some(metadata.freshness.as_str()),
                        session_generation: Some(metadata.generation),
                    })
                })
                .collect()
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not check page content states: {error}"),
    })?
}

pub(crate) fn fractal_export_html_blocking(
    project_root: String,
    page_path: String,
    output: String,
    include_derived_links: bool,
) -> FractalResult<FractalHtmlExportReport> {
    project_sessions().with_cached(&project_root, |project, _metadata| {
        let report = project.export_html(
            &page_path,
            &output,
            fractal::HtmlExportOptions {
                include_derived_links,
            },
        )?;
        Ok(FractalHtmlExportReport {
            output: report.output.to_string_lossy().into_owned(),
            references: report.references,
        })
    })
}

#[tauri::command]
pub(crate) async fn fractal_export_html(
    project_root: String,
    page_path: String,
    output: String,
    include_derived_links: bool,
) -> FractalResult<FractalHtmlExportReport> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_export_html_blocking(project_root, page_path, output, include_derived_links)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not export page: {error}")))?
}

pub(crate) fn fractal_export_folder_html_blocking(
    project_root: String,
    folder_path: String,
    output: String,
    selections: Vec<String>,
    number_sections: bool,
    include_derived_links: bool,
    force: bool,
) -> FractalResult<FractalFolderHtmlExportReport> {
    project_sessions().with_cached(&project_root, |project, _metadata| {
        let folder = if folder_path.trim().is_empty() {
            PathBuf::from(".")
        } else {
            relative_folder_path(&folder_path).map_err(FractalCommandError::from)?
        };
        let report = project.export_folder_html(
            folder,
            &output,
            fractal::FolderHtmlExportOptions {
                selections: selections.into_iter().map(PathBuf::from).collect(),
                number_sections,
                include_derived_links,
                force,
            },
        )?;
        Ok(FractalFolderHtmlExportReport {
            output: report.output.to_string_lossy().into_owned(),
            pages: report.pages,
            skipped: report.skipped,
            references: report.references,
        })
    })
}

#[tauri::command]
pub(crate) async fn fractal_export_folder_html(
    project_root: String,
    folder_path: String,
    output: String,
    selections: Vec<String>,
    number_sections: bool,
    include_derived_links: bool,
    force: bool,
) -> FractalResult<FractalFolderHtmlExportReport> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_export_folder_html_blocking(
            project_root,
            folder_path,
            output,
            selections,
            number_sections,
            include_derived_links,
            force,
        )
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not export folder: {error}")))?
}

pub(crate) fn fractal_create_page_blocking(
    project_root: String,
    title: String,
    folder_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let receipt = if let Some(folder_path) = folder_path.filter(|path| !path.trim().is_empty())
        {
            let folder = relative_folder_path(&folder_path).map_err(FractalCommandError::from)?;
            let file_name = format!(
                "{}.fractal.html",
                catalog::project_directory_name(&title).map_err(FractalCommandError::from)?
            );
            project.create_page_at(folder.join(file_name), &title)
        } else {
            project.create_page(&title)
        }?;
        let path =
            created_page_path(&receipt).ok_or("Fractal did not report the created native page.")?;
        mutation_result_with_metadata(project, Some(&path), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_create_page(
    project_root: String,
    title: String,
    folder_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_create_page_blocking(project_root, title, folder_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not create page: {error}")))?
}

pub(crate) fn fractal_duplicate_page_blocking(
    project_root: String,
    page_path: String,
    title: String,
    folder_path: Option<String>,
) -> FractalResult<FractalMutationBatchResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let source = project.native_document_parts(&page_path)?;
        let file_name = format!(
            "{}.fractal.html",
            catalog::project_directory_name(&title).map_err(FractalCommandError::from)?
        );
        let destination = match folder_path.filter(|path| !path.trim().is_empty()) {
            Some(folder) => relative_folder_path(&folder)
                .map_err(FractalCommandError::from)?
                .join(file_name),
            None => PathBuf::from(file_name),
        };
        let created = project.create_page_at(&destination, &title)?;
        let duplicate_path = created_page_path(&created)
            .ok_or("Fractal did not report the created duplicate page.")?;
        let mut receipts = vec![created];
        let steps = [
            ("content", source.content_html),
            ("style", source.style_css),
            ("metadata", source.metadata_html),
        ];
        let mut failure = None;
        for (section, value) in steps {
            let parts = project.native_document_parts(&duplicate_path)?;
            let result = match section {
                "content" if parts.content_html != value => {
                    project.set_page_content(&duplicate_path, &value, &parts.content_hash)
                }
                "style" if parts.style_css != value => {
                    project.set_page_style(&duplicate_path, &value, &parts.style_hash)
                }
                "metadata" if parts.metadata_html != value => {
                    project.set_page_metadata(&duplicate_path, &value, &parts.metadata_hash)
                }
                _ => continue,
            };
            match result {
                Ok(receipt) => receipts.push(receipt),
                Err(error) => {
                    failure = Some(error.into());
                    break;
                }
            }
        }
        Ok(FractalMutationBatchResult {
            project: project_snapshot_with_metadata(project, Some(&duplicate_path), metadata)?,
            receipts,
            failure,
        })
    })
}

#[tauri::command]
pub(crate) async fn fractal_duplicate_page(
    project_root: String,
    page_path: String,
    title: String,
    folder_path: Option<String>,
) -> FractalResult<FractalMutationBatchResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_duplicate_page_blocking(project_root, page_path, title, folder_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not duplicate page: {error}")))?
}

pub(crate) fn fractal_create_folder_blocking(
    project_root: String,
    parent: String,
    title: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let receipt = project.create_folder(parent, &title)?;
        mutation_result_with_metadata(project, active_page_path.as_deref(), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_create_folder(
    project_root: String,
    parent: String,
    title: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_create_folder_blocking(project_root, parent, title, active_page_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not create folder: {error}")))?
}

pub(crate) fn fractal_set_folder_title_blocking(
    project_root: String,
    folder_path: String,
    title: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let folder = if folder_path.trim().is_empty() {
            PathBuf::from(".")
        } else {
            relative_folder_path(&folder_path).map_err(FractalCommandError::from)?
        };
        let receipt = project.set_folder_title(folder, &title)?;
        mutation_result_with_metadata(project, active_page_path.as_deref(), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_set_folder_title(
    project_root: String,
    folder_path: String,
    title: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_set_folder_title_blocking(project_root, folder_path, title, active_page_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not rename folder: {error}")))?
}

pub(crate) fn fractal_reorder_folder_blocking(
    project_root: String,
    folder_path: String,
    order: Vec<String>,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let folder = if folder_path.trim().is_empty() {
            PathBuf::from(".")
        } else {
            relative_folder_path(&folder_path).map_err(FractalCommandError::from)?
        };
        let receipt = project.reorder_folder(folder, order)?;
        mutation_result_with_metadata(project, active_page_path.as_deref(), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_reorder_folder(
    project_root: String,
    folder_path: String,
    order: Vec<String>,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_reorder_folder_blocking(project_root, folder_path, order, active_page_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not reorder folder: {error}")))?
}

pub(crate) fn fractal_delete_folder_blocking(
    project_root: String,
    folder_path: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let relative = relative_folder_path(&folder_path).map_err(FractalCommandError::from)?;
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let receipt = project.delete_folder(&relative)?;
        mutation_result_with_metadata(project, active_page_path.as_deref(), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_delete_folder(
    project_root: String,
    folder_path: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_delete_folder_blocking(project_root, folder_path, active_page_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not delete folder: {error}")))?
}

pub(crate) fn fractal_move_page_blocking(
    project_root: String,
    page_path: String,
    destination_folder: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let file_name = Path::new(&page_path)
            .file_name()
            .ok_or("Choose a valid native page.")?;
        let destination = if destination_folder.trim().is_empty() {
            PathBuf::from(file_name)
        } else {
            relative_folder_path(&destination_folder)
                .map_err(FractalCommandError::from)?
                .join(file_name)
        };
        let receipt = project.move_page(&page_path, destination)?;
        mutation_result_with_metadata(project, active_page_path.as_deref(), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_move_page(
    project_root: String,
    page_path: String,
    destination_folder: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_move_page_blocking(
            project_root,
            page_path,
            destination_folder,
            active_page_path,
        )
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not move page: {error}")))?
}

pub(crate) fn fractal_delete_page_blocking(
    project_root: String,
    page_path: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    project_sessions().with_mutation(&project_root, |project, metadata| {
        let receipt = project.delete_page(&page_path)?;
        mutation_result_with_metadata(project, active_page_path.as_deref(), receipt, metadata)
    })
}

#[tauri::command]
pub(crate) async fn fractal_delete_page(
    project_root: String,
    page_path: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        fractal_delete_page_blocking(project_root, page_path, active_page_path)
    })
    .await
    .map_err(|error| FractalCommandError::io(format!("Could not delete page: {error}")))?
}

pub(crate) fn fractal_validate_project_blocking(
    project_root: String,
) -> FractalResult<FractalCommandResult> {
    project_sessions().with_cached(&project_root, |project, _metadata| {
        let report = project.validate();
        let details = (!report.issues.is_empty()).then(|| {
            report
                .issues
                .iter()
                .map(|issue| match &issue.path {
                    Some(path) => format!("{path}: {}", issue.message),
                    None => issue.message.clone(),
                })
                .collect::<Vec<_>>()
                .join("\n")
        });
        Ok(FractalCommandResult {
            ok: report.valid,
            message: if report.valid {
                "Project is valid."
            } else {
                "Project has validation issues."
            }
            .into(),
            details,
        })
    })
}

#[tauri::command]
pub(crate) async fn fractal_validate_project(
    project_root: String,
) -> FractalResult<FractalCommandResult> {
    tauri::async_runtime::spawn_blocking(move || fractal_validate_project_blocking(project_root))
        .await
        .map_err(|error| FractalCommandError::io(format!("Could not validate project: {error}")))?
}

#[cfg(test)]
mod tests {
    use super::{
        fractal_create_folder_blocking, fractal_create_page_blocking,
        fractal_export_folder_html_blocking, fractal_export_html_blocking,
        fractal_move_page_blocking, fractal_reorder_folder_blocking,
        fractal_set_folder_title_blocking, relative_folder_path, relative_page_path,
    };
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn page_paths_stay_relative() {
        assert!(relative_page_path("notes/today.fractal.html").is_ok());
        assert!(relative_page_path("../outside.html").is_err());
        assert!(relative_page_path("/tmp/outside.html").is_err());
        assert!(relative_page_path("").is_err());
    }

    #[test]
    fn folder_paths_stay_relative() {
        assert!(relative_folder_path("notes/daily").is_ok());
        assert!(relative_folder_path("../outside").is_err());
        assert!(relative_folder_path("notes.html").is_err());
    }

    #[test]
    fn folder_creation_requires_an_existing_parent_and_returns_one_receipt() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        fractal::Project::init(&root, "Test").unwrap();
        let root_string = root.to_string_lossy().into_owned();

        let created =
            fractal_create_folder_blocking(root_string.clone(), "".into(), "Notes".into(), None)
                .unwrap();

        assert_eq!(
            created.receipt.operation,
            fractal::MutationKind::CreateFolder
        );
        assert!(created
            .project
            .folders
            .iter()
            .any(|folder| folder.path == "notes"));
        let missing =
            fractal_create_folder_blocking(root_string, "missing".into(), "Child".into(), None)
                .err()
                .unwrap();
        assert_eq!(missing.code, fractal::FractalErrorCode::NotFound);
    }

    #[test]
    fn folder_metadata_mutations_use_fractal_and_refresh_the_snapshot() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        let mut project = fractal::Project::init(&root, "Test").unwrap();
        project.create_folder("", "Notes").unwrap();
        project
            .create_page_at("notes/one.fractal.html", "One")
            .unwrap();
        project
            .create_page_at("notes/two.fractal.html", "Two")
            .unwrap();
        let root_string = root.to_string_lossy().into_owned();

        let titled = fractal_set_folder_title_blocking(
            root_string.clone(),
            "notes".into(),
            "Field notes".into(),
            None,
        )
        .unwrap();
        assert_eq!(
            titled
                .project
                .folders
                .iter()
                .find(|folder| folder.path == "field-notes")
                .unwrap()
                .title,
            "Field notes"
        );

        let reordered = fractal_reorder_folder_blocking(
            root_string,
            "field-notes".into(),
            vec!["two.fractal.html".into(), "one.fractal.html".into()],
            None,
        )
        .unwrap();
        assert_eq!(
            reordered
                .project
                .folders
                .iter()
                .find(|folder| folder.path == "field-notes")
                .unwrap()
                .order,
            Some(vec!["two.fractal.html".into(), "one.fractal.html".into()])
        );
    }

    #[test]
    fn html_export_uses_fractals_exporter() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        let mut project = fractal::Project::init(&root, "Test").unwrap();
        project.create_page("Source").unwrap();
        project.create_page("Reference").unwrap();
        let output = temporary.path().join("source.html");

        let report = fractal_export_html_blocking(
            root.to_string_lossy().into_owned(),
            "source.fractal.html".into(),
            output.to_string_lossy().into_owned(),
            true,
        )
        .unwrap();

        assert_eq!(report.output, output.to_string_lossy());
        assert!(output.is_file());
    }

    #[test]
    fn folder_html_export_uses_fractals_selection_and_options() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        let mut project = fractal::Project::init(&root, "Test").unwrap();
        project.create_folder("", "Book").unwrap();
        project
            .create_page_at("book/first.fractal.html", "First")
            .unwrap();
        project
            .create_page_at("book/second.fractal.html", "Second")
            .unwrap();
        let output = temporary.path().join("book.html");

        let report = fractal_export_folder_html_blocking(
            root.to_string_lossy().into_owned(),
            "book".into(),
            output.to_string_lossy().into_owned(),
            vec!["second.fractal.html".into()],
            true,
            false,
            false,
        )
        .unwrap();

        assert_eq!(report.pages, vec!["book/second.fractal.html"]);
        assert!(fs::read_to_string(output)
            .unwrap()
            .contains("<h1>1. Second</h1>"));
    }

    #[test]
    fn moving_a_page_changes_only_its_parent_folder() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        let mut project = fractal::Project::init(&root, "Test").unwrap();
        project.create_folder("", "Archive").unwrap();
        project.create_page("Field Notes").unwrap();

        let moved = fractal_move_page_blocking(
            root.to_string_lossy().into_owned(),
            "field-notes.fractal.html".into(),
            "archive".into(),
            Some("field-notes.fractal.html".into()),
        )
        .unwrap();

        assert_eq!(
            moved.project.active_page_path.as_deref(),
            Some("archive/field-notes.fractal.html")
        );
        assert!(moved
            .project
            .pages
            .iter()
            .any(|page| page.path == "archive/field-notes.fractal.html"));
    }

    #[test]
    fn mutation_dto_serializes_with_the_typescript_wire_shape() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        fractal::Project::init(&root, "Test").unwrap();
        let result = fractal_create_page_blocking(
            root.to_string_lossy().into_owned(),
            "First Page".into(),
            None,
        )
        .unwrap();

        let value = serde_json::to_value(result).unwrap();
        assert_eq!(
            value["project"]["activePagePath"],
            "first-page.fractal.html"
        );
        assert_eq!(value["receipt"]["operation"], "create_page");
        assert_eq!(value["receipt"]["changes"][0]["change"], "created");
        assert_eq!(
            value["receipt"]["changes"][0]["path"],
            "pages/first-page.fractal.html"
        );
        assert_eq!(value["receipt"]["changes"][0]["entry"], "file");
        assert!(value["receipt"]["changes"][0]["after_hash"].is_string());
        assert_eq!(value["receipt"]["warnings"], serde_json::json!([]));
        assert_eq!(value["project"]["catalogVersion"], 2);
        assert_eq!(value["project"]["catalogFreshness"], "mutated");
        assert!(value["project"]["sessionGeneration"].is_number());
    }
}
