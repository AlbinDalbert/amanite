import type { FractalProject } from "./types";

export const mockProject: FractalProject = {
  name: "test_proj",
  rootPath: "/tmp/test_proj",
  theme: {
    "--project-background": "#f8f3e7",
    "--project-surface": "#fffaf0",
    "--project-text": "#2f2a22",
    "--project-muted": "#756b5d",
    "--project-border": "#ded3bf",
    "--project-accent": "#8f5f2a"
  },
  pages: [
    { name: "index", path: "pages/index.html" },
    { name: "garden", path: "pages/garden.html" },
    { name: "subpage", path: "pages/nested/subpage.html" }
  ],
  activePagePath: "pages/index.html",
  activePageSource: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>test_proj</title>
  </head>
  <body>
    <h1>test_proj</h1>
    <p>
      Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin velit magna,
      convallis eget placerat at, efficitur nec ipsum.
    </p>
    <p>
      Mauris et posuere neque, in lobortis nisi. In congue dapibus dapibus.
      Proin consectetur, dolor vel placerat eleifend, elit eros mollis dolor.
    </p>
  </body>
</html>`
};
