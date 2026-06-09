use serde::Serialize;
use std::{
    env, fs, io,
    path::{Component, Path, PathBuf},
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
struct FractalCommandResult {
    ok: bool,
    message: String,
    details: Option<String>,
}

fn projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(root) = env::var("AMANITE_PROJECT_ROOT") {
        let root = root.trim();
        if root.is_empty() {
            return Err("AMANITE_PROJECT_ROOT is set but empty.".to_string());
        }

        return Ok(PathBuf::from(root));
    }

    app.path()
        .app_data_dir()
        .map(|path| path.join("projects"))
        .map_err(|error| format!("Could not resolve Amanite project library: {error}"))
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

fn project_directory_name(project_name: &str) -> Result<String, String> {
    let project_name = project_name.trim();
    if project_name.is_empty() {
        return Err("Choose a project name before creating a project.".to_string());
    }

    let mut directory_name = String::new();
    let mut previous_was_separator = false;

    for character in project_name.chars() {
        if character.is_ascii_alphanumeric() {
            directory_name.push(character.to_ascii_lowercase());
            previous_was_separator = false;
        } else if !previous_was_separator {
            directory_name.push('-');
            previous_was_separator = true;
        }
    }

    let directory_name = directory_name.trim_matches('-');
    if directory_name.is_empty() {
        return Err("Project name must include at least one letter or number.".to_string());
    }

    Ok(directory_name.to_string())
}

fn ensure_projects_root(root: &Path) -> Result<(), String> {
    if root.exists() {
        if root.is_dir() {
            return Ok(());
        }

        return Err(format!("{} exists but is not a directory.", root.display()));
    }

    fs::create_dir_all(root).map_err(|error| {
        format!(
            "Could not create project library {}: {error}",
            root.display()
        )
    })
}

fn selected_project_root(root: &Path, directory_name: &str) -> Result<PathBuf, String> {
    let directory_name = directory_name.trim();
    let path = Path::new(directory_name);
    let mut components = path.components();

    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => Ok(root.join(directory_name)),
        _ => Err("Choose a valid project to open.".to_string()),
    }
}

fn project_summary(root: PathBuf) -> Result<FractalProjectSummary, String> {
    let manifest = fractal::project::load_project_manifest(&root).map_err(|error| {
        format!(
            "Could not load Fractal project manifest at {}: {error}",
            root.display()
        )
    })?;
    let directory_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("Could not read project directory name: {}", root.display()))?
        .to_string();
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    Ok(FractalProjectSummary {
        name: manifest.project_name,
        root_path: root.to_string_lossy().to_string(),
        directory_name,
    })
}

fn list_project_summaries(root: &Path) -> Result<Vec<FractalProjectSummary>, String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => {
            return Err(format!(
                "Could not read project library {}: {error}",
                root.display()
            ))
        }
    };

    let mut projects = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read project entry: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;

        if file_type.is_dir() && path.join("fractal.json").is_file() {
            projects.push(project_summary(path)?);
        }
    }

    projects.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.directory_name.cmp(&right.directory_name))
    });

    Ok(projects)
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

fn create_project_in_library(root: &Path, project_name: &str) -> Result<FractalProject, String> {
    let project_name = project_name.trim();
    let directory_name = project_directory_name(project_name)?;
    let project_root = root.join(&directory_name);

    ensure_projects_root(root)?;

    if project_root.exists() {
        if project_root.join("fractal.json").is_file() {
            return Err(format!(
                "A Fractal project named {project_name} already exists. Open it from the existing projects list."
            ));
        }

        return Err(format!(
            "{} already exists but is not a Fractal project.",
            project_root.display()
        ));
    }

    fractal::project::init_project_at(&project_root, project_name)
        .map_err(|error| format!("Could not create Fractal project: {error}"))?;
    fractal::project::build_index(&project_root)
        .map_err(|error| format!("Could not build Fractal project index: {error}"))?;
    read_project(project_root)
}

#[tauri::command]
fn fractal_list_projects(app: AppHandle) -> Result<FractalProjectCatalog, String> {
    let root = projects_root(&app)?;
    let projects = list_project_summaries(&root)?;

    Ok(FractalProjectCatalog {
        root_path: root.to_string_lossy().to_string(),
        projects,
    })
}

#[tauri::command]
fn fractal_create_project(app: AppHandle, project_name: String) -> Result<FractalProject, String> {
    create_project_in_library(&projects_root(&app)?, &project_name)
}

#[tauri::command]
fn fractal_open_project(app: AppHandle, directory_name: String) -> Result<FractalProject, String> {
    let root = selected_project_root(&projects_root(&app)?, &directory_name)?;
    read_project(root)
}

#[tauri::command]
fn fractal_validate_project(project_root: String) -> Result<FractalCommandResult, String> {
    let root = PathBuf::from(project_root);
    fractal::project::validate_project(&root, false)
        .map_err(|error| format!("Fractal project validation failed: {error}"))?;
    let project = read_project(root)?;

    Ok(FractalCommandResult {
        ok: true,
        message: "Project validation completed.".to_string(),
        details: Some(format!("Found {} HTML page(s).", project.pages.len())),
    })
}

#[tauri::command]
fn fractal_build_index(project_root: String) -> Result<FractalCommandResult, String> {
    let root = PathBuf::from(project_root);
    fractal::project::build_index(&root)
        .map_err(|error| format!("Could not build Fractal project index: {error}"))?;
    let project = read_project(root)?;

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
            fractal_list_projects,
            fractal_create_project,
            fractal_open_project,
            fractal_validate_project,
            fractal_build_index
        ])
        .run(tauri::generate_context!())
        .expect("error while running Amanite");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_library(name: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        let path =
            std::env::temp_dir().join(format!("amanite-{name}-{}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        path
    }

    #[test]
    fn project_directory_name_normalizes_to_single_child() {
        assert_eq!(
            project_directory_name("Field Notes 2026").expect("directory name"),
            "field-notes-2026"
        );
        assert_eq!(
            project_directory_name("  My/API:Draft  ").expect("directory name"),
            "my-api-draft"
        );
        assert!(project_directory_name("   ").is_err());
        assert!(project_directory_name("***").is_err());
    }

    #[test]
    fn selected_project_root_rejects_path_traversal() {
        let root = Path::new("/tmp/amanite-library");

        assert_eq!(
            selected_project_root(root, "notes").expect("selected project"),
            root.join("notes")
        );
        assert!(selected_project_root(root, "../notes").is_err());
        assert!(selected_project_root(root, "parent/child").is_err());
        assert!(selected_project_root(root, ".").is_err());
    }

    #[test]
    fn create_project_in_library_creates_real_fractal_scaffold() {
        let library = temp_library("create");
        let project_root = library.join("field-notes");

        let project =
            create_project_in_library(&library, "Field Notes").expect("create Fractal project");

        assert_eq!(project.name, "Field Notes");
        assert_eq!(project.active_page_path, "pages/index.html");
        assert!(project_root.join("fractal.json").is_file());
        assert!(project_root.join(".fractal/style.css").is_file());
        assert!(project_root.join(".fractal/index.json").is_file());
        assert!(project_root.join(".fractal/graph.json").is_file());
        assert!(project_root.join("pages/index.html").is_file());
        assert_eq!(
            fractal::project::load_project_manifest(&project_root)
                .expect("load manifest")
                .project_name,
            "Field Notes"
        );

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn list_project_summaries_reads_valid_child_projects() {
        let library = temp_library("list");
        let alpha = library.join("alpha");
        let beta = library.join("beta");
        let stray = library.join("not-a-project");

        fractal::project::init_project_at(&beta, "Beta").expect("create beta");
        fractal::project::build_index(&beta).expect("index beta");
        fractal::project::init_project_at(&alpha, "Alpha").expect("create alpha");
        fractal::project::build_index(&alpha).expect("index alpha");
        fs::create_dir_all(stray).expect("create stray directory");

        let projects = list_project_summaries(&library).expect("list projects");

        assert_eq!(projects.len(), 2);
        assert_eq!(projects[0].name, "Alpha");
        assert_eq!(projects[0].directory_name, "alpha");
        assert_eq!(projects[1].name, "Beta");
        assert_eq!(projects[1].directory_name, "beta");

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }
}
