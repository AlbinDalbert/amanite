use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SessionFreshness {
    Cached,
    Refreshed,
    Mutated,
}

impl SessionFreshness {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Cached => "cached",
            Self::Refreshed => "refreshed",
            Self::Mutated => "mutated",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct SessionMetadata {
    pub(crate) generation: u64,
    pub(crate) catalog_version: u64,
    pub(crate) freshness: SessionFreshness,
}

struct ProjectSession {
    project: fractal::Project,
    generation: u64,
    catalog_version: u64,
}

#[derive(Clone)]
pub(crate) struct ProjectSessionStore {
    sessions: Arc<Mutex<HashMap<PathBuf, ProjectSession>>>,
    next_generation: Arc<AtomicU64>,
}

impl Default for ProjectSessionStore {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }
}

impl ProjectSessionStore {
    pub(crate) fn with_cached<T, E, F>(&self, project_root: &str, operation: F) -> Result<T, E>
    where
        E: From<fractal::FractalError>,
        F: FnOnce(&fractal::Project, SessionMetadata) -> Result<T, E>,
    {
        let root = canonical_root::<E>(project_root)?;
        let mut sessions = self.sessions.lock().map_err(|_| {
            E::from(fractal::FractalError::new(
                fractal::FractalErrorCode::Io,
                "Project session store is unavailable.",
            ))
        })?;
        if !sessions.contains_key(&root) {
            let project = fractal::Project::open(&root).map_err(E::from)?;
            sessions.insert(
                root.clone(),
                ProjectSession {
                    project,
                    generation: self.next_generation.fetch_add(1, Ordering::Relaxed),
                    catalog_version: 1,
                },
            );
        }
        let session = sessions.get(&root).expect("session inserted above");
        operation(
            &session.project,
            SessionMetadata {
                generation: session.generation,
                catalog_version: session.catalog_version,
                freshness: SessionFreshness::Cached,
            },
        )
    }

    pub(crate) fn with_refreshed<T, E, F>(&self, project_root: &str, operation: F) -> Result<T, E>
    where
        E: From<fractal::FractalError>,
        F: FnOnce(&fractal::Project, SessionMetadata) -> Result<T, E>,
    {
        let root = canonical_root::<E>(project_root)?;
        let project = fractal::Project::open(&root).map_err(E::from)?;
        let mut sessions = self.sessions.lock().map_err(|_| {
            E::from(fractal::FractalError::new(
                fractal::FractalErrorCode::Io,
                "Project session store is unavailable.",
            ))
        })?;
        let (generation, catalog_version) = if let Some(session) = sessions.get_mut(&root) {
            session.project = project;
            session.generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
            session.catalog_version += 1;
            (session.generation, session.catalog_version)
        } else {
            let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
            sessions.insert(
                root.clone(),
                ProjectSession {
                    project,
                    generation,
                    catalog_version: 1,
                },
            );
            (generation, 1)
        };
        let session = sessions.get(&root).expect("session inserted above");
        operation(
            &session.project,
            SessionMetadata {
                generation,
                catalog_version,
                freshness: SessionFreshness::Refreshed,
            },
        )
    }

    pub(crate) fn with_mutation<T, E, F>(&self, project_root: &str, operation: F) -> Result<T, E>
    where
        E: From<fractal::FractalError>,
        F: FnOnce(&mut fractal::Project, SessionMetadata) -> Result<T, E>,
    {
        let root = canonical_root::<E>(project_root)?;
        let mut sessions = self.sessions.lock().map_err(|_| {
            E::from(fractal::FractalError::new(
                fractal::FractalErrorCode::Io,
                "Project session store is unavailable.",
            ))
        })?;
        if !sessions.contains_key(&root) {
            let project = fractal::Project::open(&root).map_err(E::from)?;
            sessions.insert(
                root.clone(),
                ProjectSession {
                    project,
                    generation: self.next_generation.fetch_add(1, Ordering::Relaxed),
                    catalog_version: 1,
                },
            );
        }
        let session = sessions.get_mut(&root).expect("session inserted above");
        let next_version = session.catalog_version + 1;
        let result = operation(
            &mut session.project,
            SessionMetadata {
                generation: session.generation,
                catalog_version: next_version,
                freshness: SessionFreshness::Mutated,
            },
        );
        if result.is_ok() {
            session.catalog_version = next_version;
        }
        result
    }

    #[cfg(test)]
    pub(crate) fn metadata(&self, project_root: &str) -> Option<SessionMetadata> {
        let root = PathBuf::from(project_root).canonicalize().ok()?;
        let sessions = self.sessions.lock().ok()?;
        let session = sessions.get(&root)?;
        Some(SessionMetadata {
            generation: session.generation,
            catalog_version: session.catalog_version,
            freshness: SessionFreshness::Cached,
        })
    }
}

fn canonical_root<E: From<fractal::FractalError>>(project_root: &str) -> Result<PathBuf, E> {
    Path::new(project_root)
        .canonicalize()
        .map_err(|error| E::from(error.into()))
}

#[cfg(test)]
mod tests {
    use super::{ProjectSessionStore, SessionFreshness};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn retains_one_project_and_versions_refreshes_and_mutations() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        fractal::Project::init(&root, "Test").unwrap();
        let root = root.to_string_lossy().into_owned();
        let store = ProjectSessionStore::default();

        let first = store
            .with_refreshed(&root, |project, metadata| {
                assert!(project.pages().is_empty());
                assert_eq!(metadata.catalog_version, 1);
                assert_eq!(metadata.freshness, SessionFreshness::Refreshed);
                Ok::<_, fractal::FractalError>(metadata)
            })
            .unwrap();
        let cached = store
            .with_cached(&root, |_project, metadata| {
                assert_eq!(metadata.generation, first.generation);
                assert_eq!(metadata.catalog_version, first.catalog_version);
                assert_eq!(metadata.freshness, SessionFreshness::Cached);
                Ok::<_, fractal::FractalError>(metadata)
            })
            .unwrap();
        assert_eq!(cached.generation, first.generation);
        assert_eq!(cached.catalog_version, first.catalog_version);

        let mutation = store
            .with_mutation(&root, |project, metadata| {
                project.create_page("First")?;
                assert_eq!(metadata.catalog_version, 2);
                assert_eq!(metadata.freshness, SessionFreshness::Mutated);
                Ok::<_, fractal::FractalError>(metadata)
            })
            .unwrap();
        assert_eq!(
            store.metadata(&root).unwrap().catalog_version,
            mutation.catalog_version
        );
        assert!(
            store
                .with_cached(&root, |project, _| Ok::<_, fractal::FractalError>(
                    project.pages().len()
                ))
                .unwrap()
                == 1
        );

        let refreshed = store
            .with_refreshed(&root, |_project, metadata| {
                Ok::<_, fractal::FractalError>(metadata)
            })
            .unwrap();
        assert!(refreshed.generation > first.generation);
        assert_eq!(refreshed.catalog_version, 3);
        assert_eq!(refreshed.freshness, SessionFreshness::Refreshed);
    }

    #[test]
    fn cached_reads_wait_for_an_explicit_refresh_after_external_changes() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        let mut project = fractal::Project::init(&root, "Test").unwrap();
        project.create_page("First").unwrap();
        drop(project);
        let root_string = root.to_string_lossy().into_owned();
        let store = ProjectSessionStore::default();
        store
            .with_refreshed(&root_string, |_project, _| {
                Ok::<_, fractal::FractalError>(())
            })
            .unwrap();

        let page_path = root.join("pages").join("first.fractal.html");
        let source = fs::read_to_string(&page_path)
            .unwrap()
            .replace("First", "Second");
        fs::write(page_path, source).unwrap();

        let cached_title = store
            .with_cached(&root_string, |project, _| {
                Ok::<_, fractal::FractalError>(project.pages()[0].title.clone())
            })
            .unwrap();
        let refreshed_title = store
            .with_refreshed(&root_string, |project, _| {
                Ok::<_, fractal::FractalError>(project.pages()[0].title.clone())
            })
            .unwrap();

        assert_eq!(cached_title.as_deref(), Some("First"));
        assert_eq!(refreshed_title.as_deref(), Some("Second"));
    }
}
