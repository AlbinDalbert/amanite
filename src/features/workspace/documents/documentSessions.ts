export type DocumentSessionIdentity = {
  documentId: string;
  projectGeneration: number;
};

let nextGeneratedProjectGeneration = 1;

export function createProjectGeneration() {
  const generation = nextGeneratedProjectGeneration;
  nextGeneratedProjectGeneration += 1;
  return generation;
}

export function documentIdentity(projectGeneration: number, path: string): DocumentSessionIdentity {
  return {
    documentId: `amanite-document-${projectGeneration}-${path}`,
    projectGeneration
  };
}

export function isSameProjectSession(left: DocumentSessionIdentity, right: DocumentSessionIdentity) {
  return left.projectGeneration === right.projectGeneration && left.documentId === right.documentId;
}
