use serde::Serialize;
use std::{
    env, fs, io,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalPage {
    body_preview: Option<String>,
    name: String,
    path: String,
    summary: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalNote {
    id: String,
    label: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalPageLink {
    href: String,
    text: String,
    scope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalGraphPageLink {
    page: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FractalProject {
    name: String,
    root_path: String,
    pages: Vec<FractalPage>,
    active_page_path: String,
    active_page_source: String,
    active_page_body_html: String,
    active_page_stylesheet: String,
    active_page_title: String,
    active_page_summary: Option<String>,
    active_page_tags: Vec<String>,
    active_page_notes: Vec<FractalNote>,
    active_page_links: Vec<FractalPageLink>,
    active_page_backlinks: Vec<FractalGraphPageLink>,
    active_page_outlinks: Vec<FractalGraphPageLink>,
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

fn normalize_page_reference(page_path: &str) -> String {
    let mut normalized = page_path
        .trim()
        .trim_start_matches("./")
        .strip_prefix("pages/")
        .unwrap_or_else(|| page_path.trim().trim_start_matches("./"))
        .replace('\\', "/");

    if Path::new(&normalized).extension().is_none() {
        normalized.push_str(".html");
    }

    normalized
}

fn decode_basic_html_entities(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn text_preview_from_html(html: &str) -> Option<String> {
    let mut text = String::new();
    let mut in_tag = false;
    let mut pending_space = false;

    for character in html.chars() {
        if in_tag {
            if character == '>' {
                in_tag = false;
                pending_space = true;
            }

            continue;
        }

        if character == '<' {
            in_tag = true;
            pending_space = true;
            continue;
        }

        if character.is_whitespace() {
            pending_space = true;
            continue;
        }

        if pending_space && !text.is_empty() {
            text.push(' ');
        }

        text.push(character);
        pending_space = false;
    }

    let text = decode_basic_html_entities(&text);
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");

    if text.is_empty() {
        None
    } else if text.chars().count() > 240 {
        Some(format!("{}…", text.chars().take(239).collect::<String>()))
    } else {
        Some(text)
    }
}

fn list_fractal_pages(root: &Path) -> Result<Vec<FractalPage>, String> {
    let mut pages = fractal::project::list_editor_pages(root)
        .map_err(|error| format!("Could not list Fractal editor pages: {error}"))?
        .into_iter()
        .map(|page| {
            let body_preview = fractal::project::editor_page_detail(root, &page.path)
                .ok()
                .and_then(|detail| text_preview_from_html(&detail.body_html));

            FractalPage {
                body_preview,
                name: page.title,
                path: page.path,
                summary: page.summary,
            }
        })
        .collect::<Vec<_>>();

    pages.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(pages)
}

fn validated_page_path(
    pages: &[FractalPage],
    page_path: &str,
    root: &Path,
) -> Result<String, String> {
    let page_path = normalize_page_reference(page_path);

    pages
        .iter()
        .find(|page| page.path == page_path)
        .map(|page| page.path.clone())
        .ok_or_else(|| {
            format!(
                "No HTML page named {page_path} was found in {}",
                root.display()
            )
        })
}

fn selected_page_path(
    pages: &[FractalPage],
    default_page: &str,
    requested_page_path: Option<&str>,
    root: &Path,
) -> Result<String, String> {
    if let Some(page_path) = requested_page_path {
        return validated_page_path(pages, page_path, root);
    }

    let default_page = normalize_page_reference(default_page);

    pages
        .iter()
        .find(|page| page.path == default_page)
        .or_else(|| pages.first())
        .map(|page| page.path.clone())
        .ok_or_else(|| format!("No HTML pages found in {}", root.display()))
}

fn read_project(root: PathBuf) -> Result<FractalProject, String> {
    read_project_with_active_page(root, None)
}

fn read_project_with_active_page(
    root: PathBuf,
    requested_page_path: Option<&str>,
) -> Result<FractalProject, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;
    let manifest = fractal::project::load_project_manifest(&root)
        .map_err(|error| format!("Could not load Fractal project manifest: {error}"))?;
    let name = manifest.project_name;
    let default_page = manifest.default_page;
    let pages = list_fractal_pages(&root)?;

    let active_page_path = selected_page_path(&pages, &default_page, requested_page_path, &root)?;
    let active_page_detail = fractal::project::editor_page_detail(&root, &active_page_path)
        .map_err(|error| {
            format!("Could not load Fractal editor page {active_page_path}: {error}")
        })?;
    let active_page_stylesheet = fs::read_to_string(root.join(".fractal").join("style.css"))
        .map_err(|error| format!("Could not read .fractal/style.css: {error}"))?;

    Ok(FractalProject {
        name,
        root_path: root.to_string_lossy().to_string(),
        pages,
        active_page_path: active_page_detail.metadata.path,
        active_page_source: active_page_detail.source.html,
        active_page_body_html: active_page_detail.body_html,
        active_page_stylesheet,
        active_page_title: active_page_detail.metadata.title,
        active_page_summary: active_page_detail.metadata.summary,
        active_page_tags: active_page_detail.metadata.tags,
        active_page_notes: active_page_detail
            .notes
            .into_iter()
            .map(|note| FractalNote {
                id: note.id,
                label: note.label,
                text: note.text,
            })
            .collect(),
        active_page_links: active_page_detail
            .links
            .into_iter()
            .map(|link| FractalPageLink {
                href: link.href,
                text: link.text,
                scope: link.scope,
            })
            .collect(),
        active_page_backlinks: active_page_detail
            .backlinks
            .into_iter()
            .map(|link| FractalGraphPageLink {
                page: link.page,
                text: link.text,
            })
            .collect(),
        active_page_outlinks: active_page_detail
            .outlinks
            .into_iter()
            .map(|link| FractalGraphPageLink {
                page: link.page,
                text: link.text,
            })
            .collect(),
    })
}

fn write_project_page(
    root: PathBuf,
    page_path: &str,
    source: &str,
) -> Result<FractalProject, String> {
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::load_project_manifest(&root)
        .map_err(|error| format!("Could not load Fractal project manifest: {error}"))?;

    let pages = list_fractal_pages(&root)?;

    let active_page_path = validated_page_path(&pages, page_path, &root)?;

    fractal::project::write_page_source(&root, &active_page_path, source)
        .map_err(|error| format!("Could not save {active_page_path}: {error}"))?;

    read_project_with_active_page(root, Some(&active_page_path))
}

fn update_project_page(
    root: PathBuf,
    page_path: &str,
    title: &str,
    body_html: &str,
    summary: &str,
    tags: Vec<String>,
) -> Result<FractalProject, String> {
    let active_page_path = normalize_page_reference(page_path);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::update_editor_page(
        &root,
        page_path,
        fractal::project::EditorPageUpdate {
            title: Some(title.to_string()),
            body_html: Some(body_html.to_string()),
            summary: Some(summary.to_string()),
            tags: Some(tags),
        },
    )
    .map_err(|error| format!("Could not update Fractal page {page_path}: {error}"))?;
    fractal::project::sync_project(&root).map_err(|error| {
        format!("Could not sync Fractal project after saving {page_path}: {error}")
    })?;

    read_project_with_active_page(root, Some(&active_page_path))
}

fn create_project_page(root: PathBuf, page_path: &str) -> Result<FractalProject, String> {
    let active_page_path = normalize_page_reference(page_path);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::new_page(&root, page_path)
        .map_err(|error| format!("Could not create Fractal page {page_path}: {error}"))?;

    read_project_with_active_page(root, Some(&active_page_path))
}

fn rename_project_page(
    root: PathBuf,
    page_path: &str,
    next_page_path: &str,
    active_page_path: &str,
) -> Result<FractalProject, String> {
    let next_page_path = next_page_path.trim();
    if next_page_path.is_empty() {
        return Err("Choose a new page path before renaming.".to_string());
    }

    let source_page_path = normalize_page_reference(page_path);
    let next_active_page_path = normalize_page_reference(next_page_path);
    let active_page_after_rename = if normalize_page_reference(active_page_path) == source_page_path
    {
        next_active_page_path.as_str()
    } else {
        active_page_path
    };
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::rename_page(
        &root,
        page_path,
        fractal::project::PageRename {
            path: Some(PathBuf::from(next_page_path)),
            title: None,
        },
    )
    .map_err(|error| {
        format!("Could not rename Fractal page {page_path} to {next_page_path}: {error}")
    })?;

    read_project_with_active_page(root, Some(active_page_after_rename))
}

fn delete_project_page(
    root: PathBuf,
    page_path: &str,
    active_page_path: &str,
) -> Result<FractalProject, String> {
    let source_page_path = normalize_page_reference(page_path);
    let active_page_path = normalize_page_reference(active_page_path);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::delete_page(&root, page_path)
        .map_err(|error| format!("Could not delete Fractal page {page_path}: {error}"))?;

    if source_page_path == active_page_path {
        read_project(root)
    } else {
        read_project_with_active_page(root, Some(&active_page_path))
    }
}

fn add_project_note(
    root: PathBuf,
    page_path: &str,
    trigger: &str,
    content: &str,
) -> Result<FractalProject, String> {
    let active_page_path = normalize_page_reference(page_path);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::add_note(&root, page_path, trigger, content)
        .map_err(|error| format!("Could not add Fractal note for {page_path}: {error}"))?;
    fractal::project::sync_project(&root)
        .map_err(|error| format!("Could not link Fractal note for {page_path}: {error}"))?;

    read_project_with_active_page(root, Some(&active_page_path))
}

fn update_project_note(
    root: PathBuf,
    page_path: &str,
    trigger: &str,
    content: &str,
) -> Result<FractalProject, String> {
    let active_page_path = normalize_page_reference(page_path);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::patch_note(&root, page_path, trigger, content)
        .map_err(|error| format!("Could not update Fractal note for {page_path}: {error}"))?;
    fractal::project::sync_project(&root)
        .map_err(|error| format!("Could not relink Fractal note for {page_path}: {error}"))?;

    read_project_with_active_page(root, Some(&active_page_path))
}

fn delete_project_note(
    root: PathBuf,
    page_path: &str,
    trigger: &str,
) -> Result<FractalProject, String> {
    let active_page_path = normalize_page_reference(page_path);
    let root = root
        .canonicalize()
        .map_err(|error| format!("Could not open project {}: {error}", root.display()))?;

    fractal::project::remove_note(&root, page_path, trigger)
        .map_err(|error| format!("Could not delete Fractal note for {page_path}: {error}"))?;
    fractal::project::sync_project(&root)
        .map_err(|error| format!("Could not unlink Fractal note for {page_path}: {error}"))?;

    read_project_with_active_page(root, Some(&active_page_path))
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
fn fractal_open_page(project_root: String, page_path: String) -> Result<FractalProject, String> {
    read_project_with_active_page(PathBuf::from(project_root), Some(&page_path))
}

#[tauri::command]
fn fractal_save_page(
    project_root: String,
    page_path: String,
    source: String,
) -> Result<FractalProject, String> {
    write_project_page(PathBuf::from(project_root), &page_path, &source)
}

#[tauri::command]
fn fractal_update_page(
    project_root: String,
    page_path: String,
    title: String,
    body_html: String,
    summary: String,
    tags: Vec<String>,
) -> Result<FractalProject, String> {
    update_project_page(
        PathBuf::from(project_root),
        &page_path,
        &title,
        &body_html,
        &summary,
        tags,
    )
}

#[tauri::command]
fn fractal_create_page(project_root: String, page_path: String) -> Result<FractalProject, String> {
    create_project_page(PathBuf::from(project_root), &page_path)
}

#[tauri::command]
fn fractal_rename_page(
    project_root: String,
    page_path: String,
    next_page_path: String,
    active_page_path: String,
) -> Result<FractalProject, String> {
    rename_project_page(
        PathBuf::from(project_root),
        &page_path,
        &next_page_path,
        &active_page_path,
    )
}

#[tauri::command]
fn fractal_delete_page(
    project_root: String,
    page_path: String,
    active_page_path: String,
) -> Result<FractalProject, String> {
    delete_project_page(PathBuf::from(project_root), &page_path, &active_page_path)
}

#[tauri::command]
fn fractal_add_note(
    project_root: String,
    page_path: String,
    trigger: String,
    content: String,
) -> Result<FractalProject, String> {
    add_project_note(PathBuf::from(project_root), &page_path, &trigger, &content)
}

#[tauri::command]
fn fractal_update_note(
    project_root: String,
    page_path: String,
    trigger: String,
    content: String,
) -> Result<FractalProject, String> {
    update_project_note(PathBuf::from(project_root), &page_path, &trigger, &content)
}

#[tauri::command]
fn fractal_delete_note(
    project_root: String,
    page_path: String,
    trigger: String,
) -> Result<FractalProject, String> {
    delete_project_note(PathBuf::from(project_root), &page_path, &trigger)
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
            fractal_open_page,
            fractal_save_page,
            fractal_update_page,
            fractal_create_page,
            fractal_rename_page,
            fractal_delete_page,
            fractal_add_note,
            fractal_update_note,
            fractal_delete_note,
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
        assert_eq!(project.active_page_path, "index.html");
        assert_eq!(project.active_page_title, "Field Notes");
        assert!(project
            .active_page_body_html
            .contains("Fractal project scaffold."));
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
    fn read_project_with_active_page_reads_selected_html_page() {
        let library = temp_library("open-page");
        let project_root = library.join("field-notes");
        let nested_page = project_root.join("pages/notes/day.html");
        let nested_source = "<main><h1>Day notes</h1></main>";

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        fs::create_dir_all(nested_page.parent().expect("nested page directory"))
            .expect("create nested page directory");
        fs::write(&nested_page, nested_source).expect("write nested page");

        let project = read_project_with_active_page(project_root, Some("pages/notes/day.html"))
            .expect("open selected page");

        assert_eq!(project.active_page_path, "notes/day.html");
        assert_eq!(project.active_page_source, nested_source);

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn read_project_with_active_page_rejects_unknown_page_path() {
        let library = temp_library("unknown-page");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");

        assert!(
            read_project_with_active_page(project_root.clone(), Some("../outside.html")).is_err()
        );
        assert!(read_project_with_active_page(project_root, Some("pages/missing.html")).is_err());

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn write_project_page_saves_selected_html_page() {
        let library = temp_library("save-page");
        let project_root = library.join("field-notes");
        let next_source = "<main><h1>Saved notes</h1></main>";

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");

        let project = write_project_page(project_root.clone(), "pages/index.html", next_source)
            .expect("save selected page");

        assert_eq!(project.active_page_path, "index.html");
        assert_eq!(project.active_page_source, next_source);
        assert_eq!(
            fs::read_to_string(project_root.join("pages/index.html")).expect("read saved page"),
            next_source
        );

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn update_project_page_saves_body_and_title_through_fractal_editor_api() {
        let library = temp_library("update-page");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");

        let project = update_project_page(
            project_root.clone(),
            "index.html",
            "Rewritten Notes",
            "<p>Saved from the rich editor.</p>",
            "Updated summary",
            vec!["editor".to_string(), "saved".to_string()],
        )
        .expect("update page");

        assert_eq!(project.active_page_path, "index.html");
        assert_eq!(project.active_page_title, "Rewritten Notes");
        assert!(project
            .active_page_body_html
            .contains("Saved from the rich editor."));
        assert_eq!(
            project.active_page_summary.as_deref(),
            Some("Updated summary")
        );
        assert_eq!(
            project.active_page_tags,
            vec!["editor".to_string(), "saved".to_string()]
        );

        let source =
            fs::read_to_string(project_root.join("pages/index.html")).expect("read updated page");
        assert!(source.contains("<title>Rewritten Notes</title>"));
        assert!(source.contains("<h1>Rewritten Notes</h1>"));
        assert!(source.contains("Saved from the rich editor."));

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn add_project_note_appends_internal_note_and_reopens_page() {
        let library = temp_library("add-note");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        update_project_page(
            project_root.clone(),
            "index.html",
            "Field Notes",
            "<p>Nested pages are useful.</p>",
            "",
            vec![],
        )
        .expect("seed note trigger text");

        let project = add_project_note(project_root.clone(), "index.html", "Nested pages", "")
            .expect("add note");

        assert_eq!(project.active_page_path, "index.html");
        assert_eq!(project.active_page_notes.len(), 1);
        assert_eq!(project.active_page_notes[0].id, "note-nested-pages");
        let source =
            fs::read_to_string(project_root.join("pages/index.html")).expect("read noted page");
        assert!(source.contains("data-fractal-note"));
        assert!(source.contains("data-fractal-link=\"note\""));

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn update_project_note_patches_internal_note() {
        let library = temp_library("update-note");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        update_project_page(
            project_root.clone(),
            "index.html",
            "Field Notes",
            "<p>Nested pages are useful.</p>",
            "",
            vec![],
        )
        .expect("seed note trigger text");
        add_project_note(project_root.clone(), "index.html", "Nested pages", "old")
            .expect("add note");

        let project = update_project_note(
            project_root.clone(),
            "index.html",
            "Nested pages",
            "updated note body",
        )
        .expect("update note");

        assert_eq!(project.active_page_notes.len(), 1);
        assert_eq!(project.active_page_notes[0].text, "updated note body");
        assert!(fs::read_to_string(project_root.join("pages/index.html"))
            .expect("read noted page")
            .contains("updated note body"));

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn delete_project_note_removes_internal_note_and_generated_link() {
        let library = temp_library("delete-note");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        update_project_page(
            project_root.clone(),
            "index.html",
            "Field Notes",
            "<p>Nested pages are useful.</p>",
            "",
            vec![],
        )
        .expect("seed note trigger text");
        add_project_note(project_root.clone(), "index.html", "Nested pages", "old")
            .expect("add note");

        let project = delete_project_note(project_root.clone(), "index.html", "Nested pages")
            .expect("delete note");

        assert!(project.active_page_notes.is_empty());
        let source =
            fs::read_to_string(project_root.join("pages/index.html")).expect("read noted page");
        assert!(!source.contains("id=\"note-nested-pages\""));
        assert!(!source.contains("href=\"#note-nested-pages\""));
        assert!(!source.contains("data-fractal-link=\"note\""));
        assert!(source.contains("Nested pages"));

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn create_project_page_creates_page_and_opens_it() {
        let library = temp_library("create-page");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        fractal::project::build_index(&project_root).expect("build index");

        let project =
            create_project_page(project_root.clone(), "notes/day").expect("create project page");

        assert_eq!(project.active_page_path, "notes/day.html");
        assert_eq!(project.active_page_title, "day");
        assert!(project_root.join("pages/notes/day.html").is_file());
        assert!(project
            .pages
            .iter()
            .any(|page| page.path == "notes/day.html"));

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn delete_project_page_removes_active_page_and_opens_remaining_page() {
        let library = temp_library("delete-page");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        fractal::project::new_page(&project_root, "notes/day").expect("create page");

        let project = delete_project_page(project_root.clone(), "notes/day.html", "notes/day.html")
            .expect("delete project page");

        assert_eq!(project.active_page_path, "index.html");
        assert!(!project_root.join("pages/notes/day.html").exists());
        assert!(!project
            .pages
            .iter()
            .any(|page| page.path == "notes/day.html"));

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn delete_project_page_preserves_active_page_when_deleting_inactive_page() {
        let library = temp_library("delete-inactive-page");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        fractal::project::new_page(&project_root, "notes/day").expect("create page");

        let project = delete_project_page(project_root.clone(), "notes/day.html", "index.html")
            .expect("delete inactive project page");

        assert_eq!(project.active_page_path, "index.html");
        assert!(!project_root.join("pages/notes/day.html").exists());

        fs::remove_dir_all(&library).expect("cleanup temp project library");
    }

    #[test]
    fn rename_project_page_moves_page_and_opens_new_path_when_active() {
        let library = temp_library("rename-page");
        let project_root = library.join("field-notes");

        fractal::project::init_project_at(&project_root, "Field Notes").expect("create project");
        fractal::project::new_page(&project_root, "notes/day").expect("create page");

        let project = rename_project_page(
            project_root.clone(),
            "notes/day.html",
            "notes/archive/day",
            "notes/day.html",
        )
        .expect("rename project page");

        assert_eq!(project.active_page_path, "notes/archive/day.html");
        assert!(!project_root.join("pages/notes/day.html").exists());
        assert!(project_root.join("pages/notes/archive/day.html").is_file());

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
