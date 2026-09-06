use serde::{Deserialize, Serialize};
use std::{
    env, fs, io,
    path::{Component, Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};

#[derive(Deserialize, Serialize)]
struct AiChatMessage {
    role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    tool_calls: Vec<AiToolCall>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_call_id: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct AiToolCall {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    function: AiToolCallFunction,
}

#[derive(Clone, Deserialize, Serialize)]
struct AiToolCallFunction {
    name: String,
    arguments: String,
}

#[derive(Deserialize, Serialize)]
struct AiTool {
    #[serde(rename = "type")]
    kind: String,
    function: AiToolFunction,
}

#[derive(Deserialize, Serialize)]
struct AiToolFunction {
    name: String,
    description: String,
    parameters: serde_json::Value,
}

#[derive(Deserialize)]
struct AiModel {
    id: String,
}

#[derive(Deserialize)]
struct AiModelsResponse {
    data: Vec<AiModel>,
}

#[derive(Deserialize, Serialize)]
struct AiChatResponseMessage {
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<AiToolCall>,
}

#[derive(Deserialize)]
struct AiChatChoice {
    message: AiChatResponseMessage,
}

#[derive(Deserialize)]
struct AiChatResponse {
    choices: Vec<AiChatChoice>,
}

#[derive(Deserialize)]
struct AiApiErrorBody {
    error: Option<AiApiError>,
}

#[derive(Deserialize)]
struct AiApiError {
    message: Option<String>,
}

fn ai_api_url(endpoint: &str, resource: &str) -> Result<reqwest::Url, String> {
    let mut endpoint = reqwest::Url::parse(endpoint.trim()).map_err(|_| {
        "Enter a complete AI endpoint, such as http://localhost:11434/v1.".to_string()
    })?;
    if endpoint.scheme() != "http" && endpoint.scheme() != "https" {
        return Err("The AI endpoint must use http or https.".into());
    }
    if endpoint.query().is_some() || endpoint.fragment().is_some() {
        return Err("The AI endpoint cannot contain a query or fragment.".into());
    }
    let path = endpoint.path().trim_end_matches('/');
    if !path.ends_with("/v1") {
        return Err("The AI endpoint must include its /v1 path.".into());
    }
    endpoint.set_path(&format!("{path}/"));
    endpoint
        .join(resource)
        .map_err(|error| format!("Could not build the AI request URL: {error}"))
}

fn ai_request(
    client: &reqwest::Client,
    url: reqwest::Url,
    api_key: &str,
) -> reqwest::RequestBuilder {
    let request = client.request(reqwest::Method::GET, url);
    if api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(api_key.trim())
    }
}

async fn ai_response_error(response: reqwest::Response) -> String {
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<AiApiErrorBody>(&body)
        .ok()
        .and_then(|body| body.error)
        .and_then(|error| error.message)
        .filter(|message| !message.trim().is_empty());
    match message {
        Some(message) => format!("AI server returned {status}: {message}"),
        None => format!("AI server returned {status}."),
    }
}

fn ai_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .user_agent("Amanite/0.2")
        .build()
        .map_err(|error| format!("Could not prepare the AI connection: {error}"))
}

#[tauri::command]
async fn ai_list_models(endpoint: String, api_key: String) -> Result<Vec<String>, String> {
    let client = ai_client()?;
    let response = ai_request(&client, ai_api_url(&endpoint, "models")?, &api_key)
        .send()
        .await
        .map_err(|error| format!("Could not reach the AI server: {error}"))?;
    if !response.status().is_success() {
        return Err(ai_response_error(response).await);
    }
    let mut models = response
        .json::<AiModelsResponse>()
        .await
        .map_err(|error| format!("The AI server returned an invalid models response: {error}"))?
        .data
        .into_iter()
        .map(|model| model.id)
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>();
    models.sort_by_key(|model| model.to_lowercase());
    models.dedup();
    Ok(models)
}

#[tauri::command]
async fn ai_chat(
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<AiChatMessage>,
    tools: Vec<AiTool>,
) -> Result<AiChatResponseMessage, String> {
    if model.trim().is_empty() {
        return Err("Choose an AI model in settings.".into());
    }
    if messages.is_empty() {
        return Err("Write a message before sending.".into());
    }
    if messages.iter().any(|message| match message.role.as_str() {
        "system" | "user" => message
            .content
            .as_deref()
            .is_none_or(|content| content.trim().is_empty()),
        "assistant" => {
            message
                .content
                .as_deref()
                .is_none_or(|content| content.trim().is_empty())
                && message.tool_calls.is_empty()
        }
        "tool" => {
            message
                .content
                .as_deref()
                .is_none_or(|content| content.trim().is_empty())
                || message
                    .tool_call_id
                    .as_deref()
                    .is_none_or(|id| id.trim().is_empty())
        }
        _ => true,
    }) {
        return Err("The chat contains an invalid message.".into());
    }

    let client = ai_client()?;
    let url = ai_api_url(&endpoint, "chat/completions")?;
    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false
    });
    if !tools.is_empty() {
        body["tools"] = serde_json::to_value(tools)
            .map_err(|error| format!("Could not prepare AI tools: {error}"))?;
        body["tool_choice"] = serde_json::Value::String("auto".into());
    }
    let request = client.post(url).json(&body);
    let request = if api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(api_key.trim())
    };
    let response = request
        .send()
        .await
        .map_err(|error| format!("Could not reach the AI server: {error}"))?;
    if !response.status().is_success() {
        return Err(ai_response_error(response).await);
    }
    response
        .json::<AiChatResponse>()
        .await
        .map_err(|error| format!("The AI server returned an invalid chat response: {error}"))?
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message)
        .filter(|message| {
            message
                .content
                .as_deref()
                .is_some_and(|content| !content.trim().is_empty())
                || !message.tool_calls.is_empty()
        })
        .ok_or_else(|| "The AI server returned an empty reply.".into())
}

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
struct FractalProject {
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalLoadedPage {
    path: String,
    source: String,
    links: Vec<fractal::Link>,
    backlinks: Vec<fractal::Backlink>,
    content_hash: String,
    native_document_parts: Option<FractalNativeDocumentParts>,
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
struct FractalProjectSummary {
    name: String,
    root_path: String,
    directory_name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalProjectCatalog {
    root_path: String,
    projects: Vec<FractalProjectSummary>,
    issues: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalCommandResult {
    ok: bool,
    message: String,
    details: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalPageContentState {
    path: String,
    content_hash: Option<String>,
    native_document_hashes: Option<FractalNativeDocumentHashes>,
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
struct FractalHtmlExportReport {
    output: String,
    references: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalFolderHtmlExportReport {
    output: String,
    pages: Vec<String>,
    skipped: Vec<fractal::SkippedExportPage>,
    references: Vec<String>,
}

#[derive(Debug, Serialize)]
struct FractalCommandError {
    code: fractal::FractalErrorCode,
    message: String,
}

impl From<fractal::FractalError> for FractalCommandError {
    fn from(error: fractal::FractalError) -> Self {
        Self {
            code: error.code,
            message: error.message,
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

type FractalResult<T> = Result<T, FractalCommandError>;

#[derive(Serialize)]
struct FractalMutationResult {
    project: FractalProject,
    receipt: fractal::MutationReceipt,
}

#[derive(Serialize)]
struct FractalMutationBatchResult {
    project: FractalProject,
    receipts: Vec<fractal::MutationReceipt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    failure: Option<FractalCommandError>,
}

fn projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(root) = env::var("AMANITE_PROJECT_ROOT") {
        let root = root.trim();
        if root.is_empty() {
            return Err("AMANITE_PROJECT_ROOT is set but empty.".into());
        }
        return Ok(PathBuf::from(root));
    }

    app.path()
        .app_data_dir()
        .map(|path| path.join("projects"))
        .map_err(|error| format!("Could not resolve Amanite project library: {error}"))
}

fn project_directory_name(project_name: &str) -> Result<String, String> {
    let project_name = project_name.trim();
    if project_name.is_empty() {
        return Err("Choose a project name before creating a project.".into());
    }

    let mut name = String::new();
    let mut separator = false;
    for character in project_name.chars() {
        if character.is_alphanumeric() {
            name.extend(character.to_lowercase());
            separator = false;
        } else if !name.is_empty() && !separator {
            name.push('-');
            separator = true;
        }
    }
    let name = name.trim_matches('-');
    if name.is_empty() {
        Err("Project name must include at least one letter or number.".into())
    } else {
        Ok(name.into())
    }
}

fn selected_project_root(root: &Path, directory_name: &str) -> Result<PathBuf, String> {
    let path = Path::new(directory_name.trim());
    let mut components = path.components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(root.join(path)),
        _ => Err("Choose a valid project to open.".into()),
    }
}

fn project_summary(root: PathBuf) -> Result<FractalProjectSummary, String> {
    let project = fractal::Project::open(&root)
        .map_err(|error| format!("Could not open Fractal project {}: {error}", root.display()))?;
    let directory_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Could not read project directory name: {}", root.display()))?
        .to_string();
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    Ok(FractalProjectSummary {
        name: project.manifest().name.clone(),
        root_path: root.to_string_lossy().into(),
        directory_name,
    })
}

fn list_project_summaries(
    root: &Path,
) -> Result<(Vec<FractalProjectSummary>, Vec<String>), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok((vec![], vec![])),
        Err(error) => {
            return Err(format!(
                "Could not read project library {}: {error}",
                root.display()
            ))
        }
    };
    let mut projects = vec![];
    let mut issues = vec![];
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                issues.push(format!("Could not read a project directory: {error}"));
                continue;
            }
        };
        let path = entry.path();
        let is_directory = match entry.file_type() {
            Ok(file_type) => file_type.is_dir(),
            Err(error) => {
                issues.push(format!("Could not inspect {}: {error}", path.display()));
                continue;
            }
        };
        if is_directory && path.join("fractal.json").is_file() {
            match project_summary(path) {
                Ok(project) => projects.push(project),
                Err(error) => issues.push(error),
            }
        }
    }
    projects.sort_by_key(|project| project.name.to_lowercase());
    Ok((projects, issues))
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
    })
}

fn read_project(root: PathBuf, active_path: Option<&str>) -> FractalResult<FractalProject> {
    let root = root.canonicalize().map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not open project {}: {error}", root.display()),
    })?;
    let project = fractal::Project::open(&root)?;
    project_snapshot(&project, active_path)
}

fn validated_project_root(project_root: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|error| format!("Could not open project: {error}"))?;
    if !root.join("fractal.json").is_file() || !root.join("pages").is_dir() {
        return Err(
            "Could not open Fractal project: missing fractal.json or pages directory.".into(),
        );
    }
    Ok(root)
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

fn relative_page_path(value: &str) -> Result<PathBuf, String> {
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

fn validated_page_target(project_root: &Path, page_path: &str) -> Result<PathBuf, String> {
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

fn open_mutable_project(root: &str) -> FractalResult<fractal::Project> {
    Ok(fractal::Project::open(root)?)
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

fn mutation_result(
    project: fractal::Project,
    active_page_path: Option<&str>,
    receipt: fractal::MutationReceipt,
) -> FractalResult<FractalMutationResult> {
    let active_page_path = page_path_after_receipt(active_page_path, &receipt);
    Ok(FractalMutationResult {
        project: project_snapshot(&project, active_page_path.as_deref())?,
        receipt,
    })
}

#[tauri::command]
fn fractal_list_projects(app: AppHandle) -> FractalResult<FractalProjectCatalog> {
    let root = projects_root(&app).map_err(FractalCommandError::from)?;
    let (projects, issues) = list_project_summaries(&root).map_err(FractalCommandError::from)?;
    Ok(FractalProjectCatalog {
        projects,
        issues,
        root_path: root.to_string_lossy().into(),
    })
}

#[tauri::command]
fn fractal_create_project(app: AppHandle, project_name: String) -> FractalResult<FractalProject> {
    let library = projects_root(&app).map_err(FractalCommandError::from)?;
    fs::create_dir_all(&library).map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not create project library: {error}"),
    })?;
    let root =
        library.join(project_directory_name(&project_name).map_err(FractalCommandError::from)?);
    fractal::Project::init(&root, project_name.trim())?;
    read_project(root, None)
}

#[tauri::command]
fn fractal_open_project(app: AppHandle, directory_name: String) -> FractalResult<FractalProject> {
    read_project(
        selected_project_root(
            &projects_root(&app).map_err(FractalCommandError::from)?,
            &directory_name,
        )
        .map_err(FractalCommandError::from)?,
        None,
    )
}

#[tauri::command]
fn fractal_open_project_path(project_root: String) -> FractalResult<FractalProject> {
    read_project(PathBuf::from(project_root), None)
}

#[tauri::command]
async fn fractal_open_page(
    project_root: String,
    page_path: String,
) -> FractalResult<FractalProject> {
    tauri::async_runtime::spawn_blocking(move || {
        read_project(PathBuf::from(project_root), Some(&page_path))
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page open: {error}"),
    })?
}

#[tauri::command]
async fn fractal_read_page(
    project_root: String,
    page_path: String,
) -> FractalResult<FractalLoadedPage> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(project_root)
            .canonicalize()
            .map_err(|error| FractalCommandError {
                code: fractal::FractalErrorCode::Io,
                message: format!("Could not open project: {error}"),
            })?;
        let project = fractal::Project::open(&root)?;
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
        })
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page read: {error}"),
    })?
}

#[tauri::command]
async fn fractal_set_page_title(
    project_root: String,
    page_path: String,
    title: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut project = open_mutable_project(&project_root)?;
        let receipt = project.set_page_title_if_unchanged(&page_path, &title, &expected_hash)?;
        mutation_result(project, Some(&page_path), receipt)
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page title change: {error}"),
    })?
}

#[tauri::command]
async fn fractal_set_page_content(
    project_root: String,
    page_path: String,
    content_html: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut project = open_mutable_project(&project_root)?;
        let receipt = project.set_page_content(&page_path, &content_html, &expected_hash)?;
        mutation_result(project, Some(&page_path), receipt)
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page content write: {error}"),
    })?
}

#[tauri::command]
async fn fractal_set_page_style(
    project_root: String,
    page_path: String,
    style_css: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut project = open_mutable_project(&project_root)?;
        let receipt = project.set_page_style(&page_path, &style_css, &expected_hash)?;
        mutation_result(project, Some(&page_path), receipt)
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page style write: {error}"),
    })?
}

#[tauri::command]
async fn fractal_set_page_metadata(
    project_root: String,
    page_path: String,
    metadata_html: String,
    expected_hash: String,
) -> FractalResult<FractalMutationResult> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut project = open_mutable_project(&project_root)?;
        let receipt = project.set_page_metadata(&page_path, &metadata_html, &expected_hash)?;
        mutation_result(project, Some(&page_path), receipt)
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete page metadata write: {error}"),
    })?
}

#[tauri::command]
fn fractal_repair_page_structure(
    project_root: String,
    page_path: String,
) -> FractalResult<FractalMutationResult> {
    let mut project = open_mutable_project(&project_root)?;
    let receipt = project.repair_page_structure(&page_path)?;
    mutation_result(project, Some(&page_path), receipt)
}

#[tauri::command]
async fn fractal_search_project(
    project_root: String,
    query: String,
) -> FractalResult<Vec<fractal::SearchResult>> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = open_mutable_project(&project_root)?;
        Ok(project.search(&query))
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not complete project search: {error}"),
    })?
}

#[tauri::command]
async fn fractal_page_content_states(
    project_root: String,
    page_paths: Vec<String>,
) -> FractalResult<Vec<FractalPageContentState>> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = validated_project_root(&project_root).map_err(FractalCommandError::from)?;
        let project = fractal::Project::open(&root)?;
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
                        FractalNativeDocumentHashes::from(&FractalNativeDocumentParts::from(parts))
                    });
                Ok(FractalPageContentState {
                    content_hash: page.map(|page| page.content_hash.clone()),
                    native_document_hashes,
                    path,
                })
            })
            .collect()
    })
    .await
    .map_err(|error| FractalCommandError {
        code: fractal::FractalErrorCode::Io,
        message: format!("Could not check page content states: {error}"),
    })?
}

#[tauri::command]
fn fractal_export_html(
    project_root: String,
    page_path: String,
    output: String,
    include_derived_links: bool,
) -> FractalResult<FractalHtmlExportReport> {
    let project = open_mutable_project(&project_root)?;
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
}

#[tauri::command]
fn fractal_export_folder_html(
    project_root: String,
    folder_path: String,
    output: String,
    selections: Vec<String>,
    number_sections: bool,
    include_derived_links: bool,
    force: bool,
) -> FractalResult<FractalFolderHtmlExportReport> {
    let project = open_mutable_project(&project_root)?;
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
}

#[tauri::command]
fn fractal_reveal_page(project_root: String, page_path: Option<String>) -> FractalResult<()> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|error| FractalCommandError {
            code: fractal::FractalErrorCode::Io,
            message: format!("Could not open project: {error}"),
        })?;
    open_mutable_project(root.to_string_lossy().as_ref())?;
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

#[tauri::command]
fn fractal_open_external(href: String) -> FractalResult<()> {
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

#[tauri::command]
fn fractal_create_page(
    project_root: String,
    title: String,
    folder_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let mut project = open_mutable_project(&project_root)?;
    let receipt = if let Some(folder_path) = folder_path.filter(|path| !path.trim().is_empty()) {
        let folder = relative_folder_path(&folder_path).map_err(FractalCommandError::from)?;
        let file_name = format!(
            "{}.fractal.html",
            project_directory_name(&title).map_err(FractalCommandError::from)?
        );
        project.create_page_at(folder.join(file_name), &title)
    } else {
        project.create_page(&title)
    }?;
    let path =
        created_page_path(&receipt).ok_or("Fractal did not report the created native page.")?;
    mutation_result(project, Some(&path), receipt)
}

#[tauri::command]
fn fractal_duplicate_page(
    project_root: String,
    page_path: String,
    title: String,
    folder_path: Option<String>,
) -> FractalResult<FractalMutationBatchResult> {
    let mut project = open_mutable_project(&project_root)?;
    let source = project.native_document_parts(&page_path)?;
    let file_name = format!(
        "{}.fractal.html",
        project_directory_name(&title).map_err(FractalCommandError::from)?
    );
    let destination = match folder_path.filter(|path| !path.trim().is_empty()) {
        Some(folder) => relative_folder_path(&folder)
            .map_err(FractalCommandError::from)?
            .join(file_name),
        None => PathBuf::from(file_name),
    };
    let created = project.create_page_at(&destination, &title)?;
    let duplicate_path =
        created_page_path(&created).ok_or("Fractal did not report the created duplicate page.")?;
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
        project: project_snapshot(&project, Some(&duplicate_path))?,
        receipts,
        failure,
    })
}

#[tauri::command]
fn fractal_create_folder(
    project_root: String,
    parent: String,
    title: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let mut project = open_mutable_project(&project_root)?;
    let receipt = project.create_folder(parent, &title)?;
    mutation_result(project, active_page_path.as_deref(), receipt)
}

#[tauri::command]
fn fractal_set_folder_title(
    project_root: String,
    folder_path: String,
    title: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let mut project = open_mutable_project(&project_root)?;
    let folder = if folder_path.trim().is_empty() {
        PathBuf::from(".")
    } else {
        relative_folder_path(&folder_path).map_err(FractalCommandError::from)?
    };
    let receipt = project.set_folder_title(folder, &title)?;
    mutation_result(project, active_page_path.as_deref(), receipt)
}

#[tauri::command]
fn fractal_reorder_folder(
    project_root: String,
    folder_path: String,
    order: Vec<String>,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let mut project = open_mutable_project(&project_root)?;
    let folder = if folder_path.trim().is_empty() {
        PathBuf::from(".")
    } else {
        relative_folder_path(&folder_path).map_err(FractalCommandError::from)?
    };
    let receipt = project.reorder_folder(folder, order)?;
    mutation_result(project, active_page_path.as_deref(), receipt)
}

#[tauri::command]
fn fractal_delete_folder(
    project_root: String,
    folder_path: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let relative = relative_folder_path(&folder_path).map_err(FractalCommandError::from)?;
    let mut project = open_mutable_project(&project_root)?;
    let receipt = project.delete_folder(&relative)?;
    mutation_result(project, active_page_path.as_deref(), receipt)
}

#[tauri::command]
fn fractal_move_page(
    project_root: String,
    page_path: String,
    destination_folder: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let mut project = open_mutable_project(&project_root)?;
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
    mutation_result(project, active_page_path.as_deref(), receipt)
}

#[tauri::command]
fn fractal_delete_page(
    project_root: String,
    page_path: String,
    active_page_path: Option<String>,
) -> FractalResult<FractalMutationResult> {
    let mut project = open_mutable_project(&project_root)?;
    let receipt = project.delete_page(&page_path)?;
    mutation_result(project, active_page_path.as_deref(), receipt)
}

#[tauri::command]
fn fractal_validate_project(project_root: String) -> FractalResult<FractalCommandResult> {
    let project = open_mutable_project(&project_root)?;
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
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    let builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init());
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![
            ai_list_models,
            ai_chat,
            fractal_list_projects,
            fractal_create_project,
            fractal_open_project,
            fractal_open_project_path,
            fractal_open_page,
            fractal_read_page,
            fractal_set_page_title,
            fractal_set_page_content,
            fractal_set_page_style,
            fractal_set_page_metadata,
            fractal_repair_page_structure,
            fractal_search_project,
            fractal_page_content_states,
            fractal_export_html,
            fractal_export_folder_html,
            fractal_reveal_page,
            fractal_open_external,
            fractal_create_page,
            fractal_duplicate_page,
            fractal_create_folder,
            fractal_set_folder_title,
            fractal_reorder_folder,
            fractal_delete_folder,
            fractal_move_page,
            fractal_delete_page,
            fractal_validate_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Amanite");
}

#[cfg(test)]
mod tests {
    use super::{
        ai_api_url, fractal_create_folder, fractal_create_page, fractal_export_folder_html,
        fractal_export_html, fractal_move_page, fractal_reorder_folder, fractal_set_folder_title,
        list_project_summaries, project_directory_name, relative_folder_path, relative_page_path,
        safe_external_url,
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
    fn project_names_become_single_directory_names() {
        assert_eq!(
            project_directory_name("Field Notes").unwrap(),
            "field-notes"
        );
        assert!(project_directory_name("***").is_err());
    }

    #[test]
    fn ai_urls_require_and_preserve_the_v1_base() {
        assert_eq!(
            ai_api_url("http://localhost:11434/v1", "models")
                .unwrap()
                .as_str(),
            "http://localhost:11434/v1/models"
        );
        assert_eq!(
            ai_api_url("https://example.com/openai/v1/", "chat/completions")
                .unwrap()
                .as_str(),
            "https://example.com/openai/v1/chat/completions"
        );
        assert!(ai_api_url("https://example.com", "models").is_err());
        assert!(ai_api_url("file:///tmp/v1", "models").is_err());
    }

    #[test]
    fn folder_creation_requires_an_existing_parent_and_returns_one_receipt() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        fractal::Project::init(&root, "Test").unwrap();
        let root_string = root.to_string_lossy().into_owned();

        let created =
            fractal_create_folder(root_string.clone(), "".into(), "Notes".into(), None).unwrap();

        assert_eq!(
            created.receipt.operation,
            fractal::MutationKind::CreateFolder
        );
        assert!(created
            .project
            .folders
            .iter()
            .any(|folder| folder.path == "notes"));
        let missing = fractal_create_folder(root_string, "missing".into(), "Child".into(), None)
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

        let titled = fractal_set_folder_title(
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

        let reordered = fractal_reorder_folder(
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

        let report = fractal_export_html(
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

        let report = fractal_export_folder_html(
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

        let moved = fractal_move_page(
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
        let result = fractal_create_page(
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
    }

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

    #[test]
    fn a_corrupt_project_does_not_hide_the_healthy_catalog() {
        let temporary = tempdir().unwrap();
        fractal::Project::init(temporary.path().join("healthy"), "Healthy").unwrap();
        let corrupt = temporary.path().join("corrupt");
        fs::create_dir(&corrupt).unwrap();
        fs::write(corrupt.join("fractal.json"), "not json").unwrap();

        let (projects, issues) = list_project_summaries(temporary.path()).unwrap();

        assert_eq!(projects.len(), 1);
        assert_eq!(projects[0].name, "Healthy");
        assert_eq!(issues.len(), 1);
    }
}
