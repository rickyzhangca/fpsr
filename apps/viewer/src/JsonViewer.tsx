import { useEffect, useRef, useState } from "react";
import { formatJson } from "./formatJson";
import { highlightJson } from "./highlightJson";

const PLACEHOLDER = "// decode a blueprint to inspect JSON";

export function JsonViewer({ value }: { value: unknown | null }) {
  const [code, setCode] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    if (value === null) {
      setCode(null);
      setHtml(null);
      return;
    }

    const gen = ++genRef.current;
    setCode(null);
    setHtml(null);

    void (async () => {
      const formatted = await formatJson(value);
      if (gen !== genRef.current) return;
      setCode(formatted);

      const highlighted = await highlightJson(formatted);
      if (gen !== genRef.current) return;
      setHtml(highlighted);
    })();
  }, [value]);

  if (value === null) {
    return <pre className="p-4 font-mono text-xs text-muted-foreground">{PLACEHOLDER}</pre>;
  }

  if (code === null) {
    return <pre className="p-4 font-mono text-xs text-muted-foreground">Formatting…</pre>;
  }

  if (html === null) {
    return <pre className="p-4 font-mono text-xs break-words whitespace-pre-wrap">{code}</pre>;
  }

  return (
    <div
      className="[&_.shiki]:bg-transparent! [&_.shiki]:p-4 [&_.shiki]:text-xs [&_.shiki]:break-words [&_.shiki]:whitespace-pre-wrap [&_.shiki]:font-mono"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
