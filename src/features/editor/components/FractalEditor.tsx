import { useEffect, useRef } from "react";
import { html } from "@codemirror/lang-html";
import { basicSetup, EditorView } from "codemirror";

type FractalEditorProps = {
  text: string;
};

function FractalEditor({ text }: FractalEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    const view = new EditorView({
      doc: text,
      extensions: [basicSetup, html(), EditorView.lineWrapping],
      parent: editorRef.current
    });

    return () => {
      view.destroy();
    };
  }, [text]);

  return <div className="fractal-editor" ref={editorRef} />;
}

export default FractalEditor;
