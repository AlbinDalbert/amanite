use serde::Serialize;
use std::{
    env, fs, io,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalPage {
    name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalProject {
    name: String,
    root_path: String,
    pages: Vec<FractalPage>,
    active_page_path: String,
    active_page_source: String,
    active_page_stylesheet: String,
}

#[derive(Serialize)]
struct FractalCommandResult {
    ok: bool,
    message: String,
    details: Option<String>,
}

fn project_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(root) = env::var("AMANITE_PROJECT_ROOT") {
        return Ok(PathBuf::from(root));
    }

    app.path()
        .app_data_dir()
        .map(|path| path.join("default-project"))
        .map_err(|error| format!("Could not resolve Amanite project directory: {error}"))
}

fn page_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("untitled")
        .to_string()
}

fn relative_slash_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|error| format!("Could not resolve page path: {error}"))?;

    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

fn collect_html_pages(
    root: &Path,
    directory: &Path,
    pages: &mut Vec<FractalPage>,
) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Could not read project directory {}: {error}",
                directory.display()
            ))
        }
    };

    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read project entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;

        if file_type.is_dir() {
            collect_html_pages(root, &path, pages)?;
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("html") {
            pages.push(FractalPage {
                name: page_name(&path),
                path: relative_slash_path(root, &path)?,
            });
        }
    }

    Ok(())
}

fn read_project(root: PathBuf) -> Result<FractalProject, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;
    let manifest = fractal::project::load_project_manifest(&root)
        .map_err(|error| format!("Could not load Fractal project manifest: {error}"))?;
    let name = manifest.project_name;
    let mut pages = Vec::new();

    collect_html_pages(&root, &root, &mut pages)?;
    pages.sort_by(|left, right| left.path.cmp(&right.path));

    let default_page = manifest.default_page;
    let active_page_path = pages
        .iter()
        .find(|page| page.path == default_page)
        .or_else(|| pages.first())
        .map(|page| page.path.clone())
        .ok_or_else(|| format!("No HTML pages found in {}", root.display()))?;
    let active_page_source = fs::read_to_string(root.join(&active_page_path))
        .map_err(|error| format!("Could not read {active_page_path}: {error}"))?;
    let active_page_stylesheet = fs::read_to_string(root.join(".fractal").join("style.css"))
        .map_err(|error| format!("Could not read .fractal/style.css: {error}"))?;

    Ok(FractalProject {
        name,
        root_path: root.to_string_lossy().to_string(),
        pages,
        active_page_path,
        active_page_source,
        active_page_stylesheet,
    })
}

fn create_project(root: &Path) -> Result<(), String> {
    if root.exists() {
        if root.join("fractal.json").is_file() {
            return Ok(());
        }

        return Err(format!(
            "{} already exists but is not a Fractal project. Set AMANITE_PROJECT_ROOT to a new directory or open an existing Fractal project root.",
            root.display()
        ));
    }

    let name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Amanite project");

    fractal::project::init_project_at(root, name)
        .map_err(|error| format!("Could not create Fractal project: {error}"))?;
    fractal::project::build_index(root)
        .map_err(|error| format!("Could not build Fractal project index: {error}"))?;
    Ok(())
}

#[tauri::command]
fn fractal_create_project(app: AppHandle) -> Result<FractalProject, String> {
    let root = project_root(&app)?;
    create_project(&root)?;
    read_project(root)
}

#[tauri::command]
fn fractal_open_project(app: AppHandle) -> Result<FractalProject, String> {
    read_project(project_root(&app)?)
}

#[tauri::command]
fn fractal_validate_project(project_root: String) -> Result<FractalCommandResult, String> {
    let project = read_project(PathBuf::from(project_root))?;

    Ok(FractalCommandResult {
        ok: true,
        message: "Project validation completed.".to_string(),
        details: Some(format!("Found {} HTML page(s).", project.pages.len())),
    })
}

#[tauri::command]
fn fractal_build_index(project_root: String) -> Result<FractalCommandResult, String> {
    let project = read_project(PathBuf::from(project_root))?;

    Ok(FractalCommandResult {
        ok: true,
        message: "Project index built.".to_string(),
        details: Some(format!("Indexed {} HTML page(s).", project.pages.len())),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            fractal_create_project,
            fractal_open_project,
            fractal_validate_project,
            fractal_build_index
        ])
        .run(tauri::generate_context!())
        .expect("error while running Amanite");
}
