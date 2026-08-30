import Icon from "./Icon";

export type TreeCrumb = {
  current: boolean;
  kind: "project" | "folder" | "page" | "ellipsis";
  label: string;
  path?: string;
};

type Props = {
  currentKind: "folder" | "page";
  disabled: boolean;
  onNavigateFolder: (path: string) => void;
  onUp?: () => void;
  path: string;
  projectName: string;
  upTitle?: string;
};

export function displayPagePath(pagePath: string) {
  return pagePath.replace(/\.fractal\.html$/iu, ".F");
}

export function buildTreeCrumbs(projectName: string, path: string, currentKind: "folder" | "page"): TreeCrumb[] {
  const segments = path.split("/").filter(Boolean);
  const folderSegments = currentKind === "page" ? segments.slice(0, -1) : segments;
  const firstVisibleFolder = Math.max(0, folderSegments.length - 2);
  const crumbs: TreeCrumb[] = [{
    current: currentKind === "folder" && !folderSegments.length,
    kind: "project",
    label: projectName,
    path: ""
  }];

  if (firstVisibleFolder) crumbs.push({ current: false, kind: "ellipsis", label: ".." });
  for (let index = firstVisibleFolder; index < folderSegments.length; index += 1) {
    crumbs.push({
      current: currentKind === "folder" && index === folderSegments.length - 1,
      kind: "folder",
      label: folderSegments[index],
      path: folderSegments.slice(0, index + 1).join("/")
    });
  }

  if (currentKind === "page") {
    crumbs.push({ current: true, kind: "page", label: displayPagePath(segments.at(-1) ?? path) });
  }
  return crumbs;
}

function TreeLocation({ currentKind, disabled, onNavigateFolder, onUp, path, projectName, upTitle = "Go up one folder" }: Props) {
  const crumbs = buildTreeCrumbs(projectName, path, currentKind);
  return (
    <nav aria-label="Location" className="tree-location">
      {onUp ? (
        <button aria-label="Go up one folder" className="tree-go-up" disabled={disabled} onClick={onUp} title={upTitle} type="button">
          <Icon name="arrow-left" size={15} />
        </button>
      ) : null}
      <ol>
        {crumbs.map((crumb, index) => (
          <li className={`tree-crumb ${crumb.kind}${crumb.current ? " current" : ""}`} key={`${crumb.kind}:${crumb.path ?? index}`}>
            {crumb.kind === "ellipsis" || crumb.kind === "page" ? (
              <span aria-current={crumb.current ? "location" : undefined}>{crumb.label}</span>
            ) : (
              <button
                aria-current={crumb.current ? "location" : undefined}
                disabled={disabled}
                onClick={() => onNavigateFolder(crumb.path ?? "")}
                title={crumb.kind === "project" ? `Open ${projectName}` : `Open ${crumb.path}`}
                type="button"
              >
                {crumb.label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default TreeLocation;
