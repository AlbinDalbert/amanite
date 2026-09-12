import Icon from "@/components/ui/Icon";
import WorkspaceTab, { acceptWorkspaceTabDrop, WORKSPACE_TAB_MIME, type DraggedWorkspaceTab, type WorkspaceTabsProps } from "./WorkspaceTab";

export { WORKSPACE_TAB_MIME, type DraggedWorkspaceTab } from "./WorkspaceTab";

function WorkspaceTabs(props: WorkspaceTabsProps) {
  return (
    <div
      className={`workspace-tab-strip${props.focused ? " focused" : ""}`}
      data-group-id={props.group.id}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) event.preventDefault();
      }}
      onDrop={(event) => acceptWorkspaceTabDrop(event, props.draggedTab, props.group.id, props.onDropTab)}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDownCapture={props.onActivate}
    >
      <div aria-label="Open editor tabs" className="editor-group-tabs" role="tablist">
        {props.group.tabs.map((path, index) => <WorkspaceTab {...props} index={index} key={path} path={path} />)}
      </div>
      {props.onCloseGroup ? <button aria-label="Close editor group" className="editor-group-close" onClick={props.onCloseGroup} title="Close editor group" type="button"><Icon name="close" size={14} /></button> : null}
    </div>
  );
}

export default WorkspaceTabs;
