type FractalEditorProps = {
  stylesheet: string;
  text: string;
};

function renderPageWithStylesheet(text: string, stylesheet: string) {
  const styleTag = `<style data-amanite-fractal-style>${stylesheet.replaceAll(
    "</style",
    "<\\/style"
  )}</style>`;

  if (text.includes("</head>")) {
    return text.replace("</head>", `${styleTag}</head>`);
  }

  return `${styleTag}${text}`;
}

function FractalEditor({ stylesheet, text }: FractalEditorProps) {
  return (
    <iframe
      className="fractal-editor"
      title="Rendered Fractal page"
      sandbox=""
      srcDoc={renderPageWithStylesheet(text, stylesheet)}
    />
  );
}

export default FractalEditor;
