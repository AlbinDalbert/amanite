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
    sessions: Arc<Mutex<HashMap<PathBuf, Arc<Mutex<ProjectSession>>>>>,
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
    fn session<E>(&self, root: &Path) -> Result<(Arc<Mutex<ProjectSession>>, bool), E>
    where
        E: From<fractal::FractalError>,
    {
        let mut sessions = self.sessions.lock().map_err(|_| session_lock_error())?;
        if let Some(session) = sessions.get(root) {
            return Ok((Arc::clone(session), false));
        }
        let session = Arc::new(Mutex::new(ProjectSession {
            project: fractal::Project::open(root).map_err(E::from)?,
            generation: self.next_generation.fetch_add(1, Ordering::Relaxed),
            catalog_version: 1,
        }));
        sessions.insert(root.to_path_buf(), Arc::clone(&session));
        Ok((session, true))
    }

    pub(crate) fn with_cached<T, E, F>(&self, project_root: &str, operation: F) -> Result<T, E>
    where
        E: From<fractal::FractalError>,
        F: FnOnce(&fractal::Project, SessionMetadata) -> Result<T, E>,
    {
        let root = canonical_root::<E>(project_root)?;
        let (session, _) = self.session::<E>(&root)?;
        let session = session.lock().map_err(|_| session_lock_error())?;
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
        self.with_refreshed_using(project_root, |root| fractal::Project::open(root), operation)
    }

    fn with_refreshed_using<T, E, L, F>(
        &self,
        project_root: &str,
        loader: L,
        operation: F,
    ) -> Result<T, E>
    where
        E: From<fractal::FractalError>,
        L: FnOnce(&Path) -> Result<fractal::Project, fractal::FractalError>,
        F: FnOnce(&fractal::Project, SessionMetadata) -> Result<T, E>,
    {
        let root = canonical_root::<E>(project_root)?;
        let (session, inserted) = self.session::<E>(&root)?;
        let mut session = session.lock().map_err(|_| session_lock_error())?;
        if !inserted {
            let loaded = loader(&root).map_err(E::from)?;
            let changed = session.project.manifest() != loaded.manifest()
                || session.project.pages() != loaded.pages()
                || session.project.folders() != loaded.folders();
            session.project = loaded;
            if changed {
                session.catalog_version += 1;
            }
        }
        let generation = session.generation;
        let catalog_version = session.catalog_version;
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
        let (session, _) = self.session::<E>(&root)?;
        let mut session = session.lock().map_err(|_| session_lock_error())?;
        let next_version = session.catalog_version + 1;
        let generation = session.generation;
        let result = operation(
            &mut session.project,
            SessionMetadata {
                generation,
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
        let session = Arc::clone(sessions.get(&root)?);
        drop(sessions);
        let session = session.lock().ok()?;
        Some(SessionMetadata {
            generation: session.generation,
            catalog_version: session.catalog_version,
            freshness: SessionFreshness::Cached,
        })
    }
}

fn session_lock_error<E: From<fractal::FractalError>>() -> E {
    E::from(fractal::FractalError::new(
        fractal::FractalErrorCode::Io,
        "Project session store is unavailable.",
    ))
}

fn canonical_root<E: From<fractal::FractalError>>(project_root: &str) -> Result<PathBuf, E> {
    Path::new(project_root)
        .canonicalize()
        .map_err(|error| E::from(error.into()))
}

#[cfg(test)]
mod tests {
    use super::{ProjectSessionStore, SessionFreshness};
    use std::{fs, sync::mpsc, thread, time::Duration};
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
        assert_eq!(refreshed.generation, first.generation);
        assert_eq!(refreshed.catalog_version, 2);
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

    #[test]
    fn refresh_cannot_replace_a_mutation_that_started_while_loading() {
        let temporary = tempdir().unwrap();
        let root = temporary.path().join("project");
        fractal::Project::init(&root, "Test").unwrap();
        let root = root.to_string_lossy().into_owned();
        let store = ProjectSessionStore::default();
        store
            .with_cached(&root, |_project, _| Ok::<_, fractal::FractalError>(()))
            .unwrap();

        let (loading_tx, loading_rx) = mpsc::channel();
        let (continue_tx, continue_rx) = mpsc::channel();
        let refresh_store = store.clone();
        let refresh_root = root.clone();
        let refresh = thread::spawn(move || {
            refresh_store
                .with_refreshed_using(
                    &refresh_root,
                    |path| {
                        loading_tx.send(()).unwrap();
                        continue_rx.recv().unwrap();
                        fractal::Project::open(path)
                    },
                    |_project, _| Ok::<_, fractal::FractalError>(()),
                )
                .unwrap();
        });
        loading_rx.recv().unwrap();

        let (mutated_tx, mutated_rx) = mpsc::channel();
        let (mutation_started_tx, mutation_started_rx) = mpsc::channel();
        let mutation_store = store.clone();
        let mutation_root = root.clone();
        let mutation = thread::spawn(move || {
            mutation_started_tx.send(()).unwrap();
            mutation_store
                .with_mutation(&mutation_root, |project, _| {
                    project.create_page("After refresh")?;
                    Ok::<_, fractal::FractalError>(())
                })
                .unwrap();
            mutated_tx.send(()).unwrap();
        });
        mutation_started_rx.recv().unwrap();
        assert!(mutated_rx.recv_timeout(Duration::from_millis(50)).is_err());

        continue_tx.send(()).unwrap();
        refresh.join().unwrap();
        mutation.join().unwrap();
        let paths = store
            .with_cached(&root, |project, _| {
                Ok::<_, fractal::FractalError>(
                    project
                        .pages()
                        .into_iter()
                        .map(|page| page.path)
                        .collect::<Vec<_>>(),
                )
            })
            .unwrap();
        assert_eq!(paths, vec!["after-refresh.fractal.html"]);
    }

    #[test]
    fn a_slow_refresh_does_not_block_another_project() {
        let temporary = tempdir().unwrap();
        let first_root = temporary.path().join("first");
        let second_root = temporary.path().join("second");
        fractal::Project::init(&first_root, "First").unwrap();
        fractal::Project::init(&second_root, "Second").unwrap();
        let first_root = first_root.to_string_lossy().into_owned();
        let second_root = second_root.to_string_lossy().into_owned();
        let store = ProjectSessionStore::default();
        store
            .with_cached(&first_root, |_, _| Ok::<_, fractal::FractalError>(()))
            .unwrap();
        store
            .with_cached(&second_root, |_, _| Ok::<_, fractal::FractalError>(()))
            .unwrap();

        let (loading_tx, loading_rx) = mpsc::channel();
        let (continue_tx, continue_rx) = mpsc::channel();
        let refresh_store = store.clone();
        let refresh = thread::spawn(move || {
            refresh_store
                .with_refreshed_using(
                    &first_root,
                    |path| {
                        loading_tx.send(()).unwrap();
                        continue_rx.recv().unwrap();
                        fractal::Project::open(path)
                    },
                    |_, _| Ok::<_, fractal::FractalError>(()),
                )
                .unwrap();
        });
        loading_rx.recv().unwrap();

        let second_title = store
            .with_cached(&second_root, |project, _| {
                Ok::<_, fractal::FractalError>(project.manifest().name.clone())
            })
            .unwrap();
        assert_eq!(second_title, "Second");

        continue_tx.send(()).unwrap();
        refresh.join().unwrap();
    }
}
