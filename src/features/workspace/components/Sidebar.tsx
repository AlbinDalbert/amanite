import type { FractalPage } from "@/lib/fractal/types";
import FileExplorer from "./FileExplorer";

type SidebarProps = {
  activePagePath: string;
  pages: FractalPage[];
  projectName: string;
  onSelectPage: (pagePath: string) => void;
};

function Sidebar({ activePagePath, pages, projectName, onSelectPage }: SidebarProps) {
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

      <nav className="file-explorer" aria-label="Project files">
        <FileExplorer
          activePagePath={activePagePath}
          pages={pages}
          onSelectPage={onSelectPage}
        />
      </nav>
    </aside>
  );
}

export default Sidebar;
