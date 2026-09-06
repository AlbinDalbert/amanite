use crate::fractal_adapter::FractalProjectSummary;
use std::{
    env, fs, io,
    path::{Component, Path, PathBuf},
};
use tauri::{AppHandle, Manager};

pub(crate) fn projects_root(app: &AppHandle) -> Result<PathBuf, String> {
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

pub(crate) fn project_directory_name(project_name: &str) -> Result<String, String> {
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

pub(crate) fn selected_project_root(root: &Path, directory_name: &str) -> Result<PathBuf, String> {
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

pub(crate) fn list_project_summaries(
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

#[cfg(test)]
mod tests {
    use super::{list_project_summaries, project_directory_name};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn project_names_become_single_directory_names() {
        assert_eq!(
            project_directory_name("Field Notes").unwrap(),
            "field-notes"
        );
        assert!(project_directory_name("***").is_err());
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
