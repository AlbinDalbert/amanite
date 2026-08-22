use serde::Serialize;
use std::{
    env, fs, io,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalProject {
    name: String,
    root_path: String,
    pages: Vec<fractal::Page>,
    active_page_path: Option<String>,
    active_page_source: Option<String>,
    active_page_links: Vec<fractal::Link>,
    active_page_backlinks: Vec<fractal::Backlink>,
    active_page_iframes: Vec<fractal::Iframe>,
    active_page_iframe_backlinks: Vec<fractal::IframeBacklink>,
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalCommandResult {
    ok: bool,
    message: String,
    details: Option<String>,
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

fn list_project_summaries(root: &Path) -> Result<Vec<FractalProjectSummary>, String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(vec![]),
        Err(error) => {
            return Err(format!(
                "Could not read project library {}: {error}",
                root.display()
            ))
        }
    };
    let mut projects = vec![];
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read project entry: {error}"))?;
        let path = entry.path();
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
            && path.join("fractal.json").is_file()
        {
            projects.push(project_summary(path)?);
        }
    }
    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(projects)
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
        ),
        None => (None, vec![], vec![], vec![], vec![]),
    };

    Ok(FractalProject {
        name: project.manifest().name.clone(),
        root_path: root.to_string_lossy().into(),
        pages,
        active_page_path: active_path,
        active_page_source,
        active_page_links,
        active_page_backlinks,
        active_page_iframes,
        active_page_iframe_backlinks,
    })
}

fn open_mutable_project(root: &str) -> Result<fractal::Project, String> {
    fractal::Project::open(root).map_err(|error| format!("Could not open Fractal project: {error}"))
}

#[tauri::command]
fn fractal_list_projects(app: AppHandle) -> Result<FractalProjectCatalog, String> {
    let root = projects_root(&app)?;
    Ok(FractalProjectCatalog {
        projects: list_project_summaries(&root)?,
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
fn fractal_open_page(project_root: String, page_path: String) -> Result<FractalProject, String> {
    read_project(PathBuf::from(project_root), Some(&page_path))
}

#[tauri::command]
fn fractal_write_page(
    project_root: String,
    page_path: String,
    source: String,
) -> Result<FractalProject, String> {
    let mut project = open_mutable_project(&project_root)?;
    project
        .write_page(&page_path, &source)
        .map_err(|error| format!("Could not write {page_path}: {error}"))?;
    read_project(PathBuf::from(project_root), Some(&page_path))
}

#[tauri::command]
fn fractal_create_page(project_root: String, title: String) -> Result<FractalProject, String> {
    let mut project = open_mutable_project(&project_root)?;
    let mutation = project
        .create_page(&title)
        .map_err(|error| format!("Could not create page: {error}"))?;
    let path = mutation
        .changed
        .first()
        .ok_or("Fractal did not return the new page path.")?;
    read_project(PathBuf::from(project_root), Some(&path.to_string_lossy()))
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    let builder = tauri::Builder::default();
    #[cfg(feature = "webdriver")]
    let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

    builder
        .invoke_handler(tauri::generate_handler![
            fractal_list_projects,
            fractal_create_project,
            fractal_open_project,
            fractal_open_page,
            fractal_write_page,
            fractal_create_page,
            fractal_move_page,
            fractal_delete_page,
            fractal_validate_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Amanite");
}
