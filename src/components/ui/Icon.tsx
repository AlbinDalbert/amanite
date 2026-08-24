import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "arrow-left"
  | "arrow-right"
  | "close"
  | "file-plus"
  | "folder-plus"
  | "maximize"
  | "menu"
  | "minimize"
  | "search"
  | "settings"
  | "split"
  | "upload";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  name: IconName;
  size?: number;
};

const paths: Record<IconName, ReactNode> = {
  "arrow-left": <><path d="m14.5 5-7 7 7 7" /><path d="M8 12h9" /></>,
  "arrow-right": <><path d="m9.5 5 7 7-7 7" /><path d="M16 12H7" /></>,
  close: <><path d="m7 7 10 10" /><path d="M17 7 7 17" /></>,
  "file-plus": <><path d="M7 3.5h6l4 4V20H7z" /><path d="M13 3.5v4h4" /><path d="M12 11v5" /><path d="M9.5 13.5h5" /></>,
  "folder-plus": <><path d="M3.5 7.5h6l2-2H20v13H3.5z" /><path d="M12 10.5v5" /><path d="M9.5 13h5" /></>,
  maximize: <><path d="M5.5 5.5h13v13h-13z" /></>,
  menu: <><path d="M5 7.5h14" /><path d="M5 12h14" /><path d="M5 16.5h14" /></>,
  minimize: <><path d="M6 12h12" /></>,
  search: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18" /></>,
  split: <><rect x="4" y="5" width="16" height="14" rx="1" /><path d="M12 5v14" /></>,
  upload: <><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M5 14v5h14v-5" /></>
};

function Icon({ name, size = 16, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.65">
        {paths[name]}
      </g>
    </svg>
  );
}

export default Icon;
