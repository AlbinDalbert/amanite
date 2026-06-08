type FractalEditorProps = {
  text: string;
};

function FractalEditor({ text }: FractalEditorProps) {
  return (
    <iframe
      className="fractal-editor"
      title="Rendered Fractal page"
      sandbox=""
      srcDoc={text}
    />
  );
}

export default FractalEditor;
