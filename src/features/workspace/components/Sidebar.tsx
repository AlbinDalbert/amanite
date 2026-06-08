import type { FractalPage } from "@/lib/fractal/types";

type SidebarProps = {
  activePagePath: string;
  pages: FractalPage[];
  projectName: string;
};

function Sidebar({ activePagePath, pages, projectName }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="File explorer">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Amanite</h1>
          <p>{projectName}</p>
        </div>
      </div>

      <div className="explorer-header">
        <span>Pages</span>
        <button type="button" aria-label="Create page">
          +
        </button>
      </div>

      <nav className="file-list" aria-label="Project files">
        {pages.map((page) => {
          const isActive = page.path === activePagePath;

          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={isActive ? "file-link active" : "file-link"}
              key={page.path}
              type="button"
              title={page.path}
            >
              <span className="file-name">{page.name}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export default Sidebar;
