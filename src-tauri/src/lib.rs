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
        "assistant" => message
            .content
            .as_deref()
            .is_none_or(|content| content.trim().is_empty())
            && message.tool_calls.is_empty(),
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
struct FractalProject {
    name: String,
    root_path: String,
    pages: Vec<fractal::Page>,
    folders: Vec<String>,
    active_page_path: Option<String>,
    active_page_source: Option<String>,
    active_page_links: Vec<fractal::Link>,
    active_page_backlinks: Vec<fractal::Backlink>,
    active_page_iframes: Vec<fractal::Iframe>,
    active_page_iframe_backlinks: Vec<fractal::IframeBacklink>,
    active_page_content_hash: Option<String>,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalHtmlExportReport {
    output: String,
    references: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalSavedPage {
    page: fractal::Page,
    content_hash: String,
    backlinks: Vec<fractal::Backlink>,
    iframe_backlinks: Vec<fractal::IframeBacklink>,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
enum FractalConditionalWriteResult {
    Saved {
        #[serde(rename = "savedPage")]
        saved_page: FractalSavedPage,
    },
    Conflict { message: String },
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

fn read_project(root: PathBuf, active_path: Option<&str>) -> Result<FractalProject, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;
    let project = fractal::Project::open(&root)
        .map_err(|error| format!("Could not open Fractal project: {error}"))?;
    let pages = project.pages();
    let active_path = match active_path {
        Some(path) => Some(
            project
                .page(path)
                .map_err(|error| format!("Could not open {path}: {error}"))?
                .path,
        ),
        None => pages.first().map(|page| page.path.clone()),
    };
    let (
        active_page_source,
        active_page_links,
        active_page_backlinks,
        active_page_iframes,
        active_page_iframe_backlinks,
        active_page_content_hash,
    ) = match active_path.as_deref() {
        Some(path) => (
            Some(
                project
                    .source(path)
                    .map_err(|error| format!("Could not read {path}: {error}"))?,
            ),
            project
                .links(path)
                .map_err(|error| format!("Could not read links for {path}: {error}"))?,
            project
                .backlinks(path)
                .map_err(|error| format!("Could not read backlinks for {path}: {error}"))?,
            project
                .iframes(path)
                .map_err(|error| format!("Could not read iframes for {path}: {error}"))?,
            project
                .iframe_backlinks(path)
                .map_err(|error| format!("Could not read iframe backlinks for {path}: {error}"))?,
            Some(
                project
                    .content_hash(path)
                    .map_err(|error| format!("Could not hash {path}: {error}"))?,
            ),
        ),
        None => (None, vec![], vec![], vec![], vec![], None),
    };

    let folders = list_page_folders(&root)?;
    Ok(FractalProject {
        name: project.manifest().name.clone(),
        root_path: root.to_string_lossy().into(),
        pages,
        folders,
        active_page_path: active_path,
        active_page_source,
        active_page_links,
        active_page_backlinks,
        active_page_iframes,
        active_page_iframe_backlinks,
        active_page_content_hash,
    })
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

fn list_page_folders(project_root: &Path) -> Result<Vec<String>, String> {
    fn visit(root: &Path, directory: &Path, folders: &mut Vec<String>) -> Result<(), String> {
        let entries = fs::read_dir(directory)
            .map_err(|error| format!("Could not read folder {}: {error}", directory.display()))?;
        for entry in entries {
            let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
            if entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_dir()
            {
                let path = entry.path();
                folders.push(
                    path.strip_prefix(root)
                        .map_err(|error| error.to_string())?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
                visit(root, &path, folders)?;
            }
        }
        Ok(())
    }

    let pages_root = project_root.join("pages");
    let mut folders = vec![];
    visit(&pages_root, &pages_root, &mut folders)?;
    folders.sort_by_key(|folder| folder.to_lowercase());
    Ok(folders)
}

fn open_mutable_project(root: &str) -> Result<fractal::Project, String> {
    fractal::Project::open(root).map_err(|error| format!("Could not open Fractal project: {error}"))
}

#[tauri::command]
fn fractal_list_projects(app: AppHandle) -> Result<FractalProjectCatalog, String> {
    let root = projects_root(&app)?;
    let (projects, issues) = list_project_summaries(&root)?;
    Ok(FractalProjectCatalog {
        projects,
        issues,
        root_path: root.to_string_lossy().into(),
    })
}

#[tauri::command]
fn fractal_create_project(app: AppHandle, project_name: String) -> Result<FractalProject, String> {
    let library = projects_root(&app)?;
    fs::create_dir_all(&library)
        .map_err(|error| format!("Could not create project library: {error}"))?;
    let root = library.join(project_directory_name(&project_name)?);
    fractal::Project::init(&root, project_name.trim())
        .map_err(|error| format!("Could not create Fractal project: {error}"))?;
    read_project(root, None)
}

#[tauri::command]
fn fractal_open_project(app: AppHandle, directory_name: String) -> Result<FractalProject, String> {
    read_project(
        selected_project_root(&projects_root(&app)?, &directory_name)?,
        None,
    )
}

#[tauri::command]
fn fractal_open_project_path(project_root: String) -> Result<FractalProject, String> {
    read_project(PathBuf::from(project_root), None)
}

#[tauri::command]
async fn fractal_open_page(
    project_root: String,
    page_path: String,
) -> Result<FractalProject, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_project(PathBuf::from(project_root), Some(&page_path))
    })
    .await
    .map_err(|error| format!("Could not complete page open: {error}"))?
}

#[tauri::command]
async fn fractal_write_page(
    project_root: String,
    page_path: String,
    source: String,
) -> Result<FractalProject, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut project = open_mutable_project(&project_root)?;
        project
            .write_page(&page_path, &source)
            .map_err(|error| format!("Could not write {page_path}: {error}"))?;
        read_project(PathBuf::from(project_root), Some(&page_path))
    })
    .await
    .map_err(|error| format!("Could not complete page write: {error}"))?
}

#[tauri::command]
async fn fractal_write_page_if_unchanged(
    project_root: String,
    page_path: String,
    source: String,
    expected_hash: String,
) -> Result<FractalConditionalWriteResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut project = open_mutable_project(&project_root)?;
        match project.write_page_if_unchanged(&page_path, &source, &expected_hash) {
            Ok(_) => {
                let page = project
                    .pages()
                    .into_iter()
                    .find(|page| page.path == page_path)
                    .ok_or_else(|| format!("Fractal did not return {page_path} after saving."))?;
                let backlinks = project
                    .backlinks(&page_path)
                    .map_err(|error| format!("Could not read backlinks for {page_path}: {error}"))?;
                let iframe_backlinks = project
                    .iframe_backlinks(&page_path)
                    .map_err(|error| format!("Could not read iframe backlinks for {page_path}: {error}"))?;
                Ok(FractalConditionalWriteResult::Saved {
                    saved_page: FractalSavedPage {
                        content_hash: page.content_hash.clone(),
                        page,
                        backlinks,
                        iframe_backlinks,
                    },
                })
            }
            Err(error) if error.code == fractal::FractalErrorCode::Conflict => {
                Ok(FractalConditionalWriteResult::Conflict {
                    message: error.message,
                })
            }
            Err(error) => Err(format!("Could not write {page_path}: {error}")),
        }
    })
    .await
    .map_err(|error| format!("Could not complete conditional page write: {error}"))?
}

#[tauri::command]
async fn fractal_search_project(
    project_root: String,
    query: String,
) -> Result<Vec<fractal::SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let project = open_mutable_project(&project_root)?;
        Ok(project.search(&query))
    })
    .await
    .map_err(|error| format!("Could not complete project search: {error}"))?
}

#[tauri::command]
async fn fractal_page_content_states(
    project_root: String,
    page_paths: Vec<String>,
) -> Result<Vec<FractalPageContentState>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = validated_project_root(&project_root)?;
        let project = fractal::Project::open(&root)
            .map_err(|error| format!("Could not open Fractal project: {error}"))?;
        let hashes = project
            .pages()
            .into_iter()
            .map(|page| (page.path, page.content_hash))
            .collect::<std::collections::BTreeMap<_, _>>();
        page_paths
            .into_iter()
            .map(|path| {
                relative_page_path(&path)?;
                Ok(FractalPageContentState {
                    content_hash: hashes.get(&path).cloned(),
                    path,
                })
            })
            .collect()
    })
    .await
    .map_err(|error| format!("Could not check page content states: {error}"))?
}

#[tauri::command]
fn fractal_export_html(
    project_root: String,
    page_path: String,
    output: String,
    include_derived_links: bool,
) -> Result<FractalHtmlExportReport, String> {
    let project = open_mutable_project(&project_root)?;
    let report = project
        .export_html(
            &page_path,
            &output,
            fractal::HtmlExportOptions {
                include_derived_links,
            },
        )
        .map_err(|error| format!("Could not export {page_path}: {error}"))?;
    Ok(FractalHtmlExportReport {
        output: report.output.to_string_lossy().into_owned(),
        references: report.references,
    })
}

#[tauri::command]
fn fractal_reveal_page(project_root: String, page_path: Option<String>) -> Result<(), String> {
    let root = PathBuf::from(project_root)
        .canonicalize()
        .map_err(|error| format!("Could not open project: {error}"))?;
    open_mutable_project(root.to_string_lossy().as_ref())?;
    let target = match page_path {
        Some(path) => validated_page_target(&root, &path)?,
        None => root,
    };
    if !target.exists() {
        return Err(format!(
            "Could not reveal {} because it does not exist.",
            target.display()
        ));
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
    command
        .spawn()
        .map_err(|error| format!("Could not open the file manager: {error}"))?;
    Ok(())
}

#[tauri::command]
fn fractal_create_page(
    project_root: String,
    title: String,
    folder_path: Option<String>,
) -> Result<FractalProject, String> {
    let mut project = open_mutable_project(&project_root)?;
    let mutation = if let Some(folder_path) = folder_path.filter(|path| !path.trim().is_empty()) {
        let folder = relative_folder_path(&folder_path)?;
        let file_name = format!("{}.fractal.html", project_directory_name(&title)?);
        project.create_page_at(folder.join(file_name), &title)
    } else {
        project.create_page(&title)
    }
    .map_err(|error| format!("Could not create page: {error}"))?;
    let path = mutation
        .changed
        .first()
        .ok_or("Fractal did not return the new page path.")?;
    read_project(PathBuf::from(project_root), Some(&path.to_string_lossy()))
}

#[tauri::command]
fn fractal_import_native_page(
    project_root: String,
    title: String,
    source: String,
    folder_path: Option<String>,
) -> Result<FractalProject, String> {
    let mut project = open_mutable_project(&project_root)?;
    let file_name = format!("{}.fractal.html", project_directory_name(&title)?);
    let destination = match folder_path.filter(|path| !path.trim().is_empty()) {
        Some(folder) => relative_folder_path(&folder)?.join(file_name),
        None => PathBuf::from(file_name),
    };
    let mutation = project
        .create_page_at(&destination, &title)
        .map_err(|error| format!("Could not create imported page: {error}"))?;
    let page_path = mutation
        .changed
        .first()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .ok_or("Fractal did not return the imported page path.")?;
    if let Err(error) = project.write_page(&page_path, &source) {
        let _ = project.delete_page(&page_path);
        return Err(format!("Could not import native HTML: {error}"));
    }
    read_project(PathBuf::from(project_root), Some(&page_path))
}

#[tauri::command]
fn fractal_create_folder(
    project_root: String,
    folder_path: String,
    active_page_path: Option<String>,
) -> Result<FractalProject, String> {
    let relative = relative_folder_path(&folder_path)?;
    let root = PathBuf::from(&project_root);
    open_mutable_project(&project_root)?;
    let destination = root.join("pages").join(relative);
    if destination.exists() {
        return Err("That folder already exists.".into());
    }
    fs::create_dir_all(&destination)
        .map_err(|error| format!("Could not create folder: {error}"))?;
    read_project(root, active_page_path.as_deref())
}

#[tauri::command]
fn fractal_delete_folder(
    project_root: String,
    folder_path: String,
    active_page_path: Option<String>,
) -> Result<FractalProject, String> {
    let relative = relative_folder_path(&folder_path)?;
    let prefix = format!("{}/", relative.to_string_lossy().replace('\\', "/"));
    let root = PathBuf::from(&project_root);
    let mut project = open_mutable_project(&project_root)?;
    project
        .delete_folder(&relative)
        .map_err(|error| format!("Could not delete folder: {error}"))?;
    let active = active_page_path
        .as_deref()
        .filter(|path| !path.starts_with(&prefix));
    read_project(root, active)
}

#[tauri::command]
fn fractal_move_page(
    project_root: String,
    page_path: String,
    destination: String,
    active_page_path: Option<String>,
) -> Result<FractalProject, String> {
    let mut project = open_mutable_project(&project_root)?;
    project
        .move_page(&page_path, &destination)
        .map_err(|error| format!("Could not move {page_path}: {error}"))?;
    let active = if active_page_path.as_deref() == Some(&page_path) {
        Some(destination.as_str())
    } else {
        active_page_path.as_deref()
    };
    read_project(PathBuf::from(project_root), active)
}

#[tauri::command]
fn fractal_delete_page(
    project_root: String,
    page_path: String,
    active_page_path: Option<String>,
) -> Result<FractalProject, String> {
    let mut project = open_mutable_project(&project_root)?;
    project
        .delete_page(&page_path)
        .map_err(|error| format!("Could not delete {page_path}: {error}"))?;
    let active = active_page_path
        .as_deref()
        .filter(|path| *path != page_path);
    read_project(PathBuf::from(project_root), active)
}

#[tauri::command]
fn fractal_validate_project(project_root: String) -> Result<FractalCommandResult, String> {
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

#[cfg(test)]
mod tests {
    use super::{
        ai_api_url, fractal_delete_folder, fractal_export_html, list_project_summaries,
        project_directory_name, relative_folder_path, relative_page_path,
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
    fn folder_deletion_uses_the_fractal_folder_transaction() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        let mut project = fractal::Project::init(&root, "Test").unwrap();
        project
            .create_page_at("notes/one.fractal.html", "One")
            .unwrap();
        fs::write(root.join("pages/notes/attachment.txt"), "kept with folder").unwrap();

        fractal_delete_folder(root.to_string_lossy().into_owned(), "notes".into(), None).unwrap();

        assert!(!root.join("pages/notes").exists());
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
            fractal_write_page,
            fractal_write_page_if_unchanged,
            fractal_search_project,
            fractal_page_content_states,
            fractal_export_html,
            fractal_reveal_page,
            fractal_create_page,
            fractal_import_native_page,
            fractal_create_folder,
            fractal_delete_folder,
            fractal_move_page,
            fractal_delete_page,
            fractal_validate_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Amanite");
}
