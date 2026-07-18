import { ScrollArea } from "@/components/ui/scroll-area";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { formatJson } from "./format-json";
const PLACEHOLDER = "// decode a blueprint to inspect JSON";
const VIRTUALIZE_MIN_CHARS = 200000;
const VirtualizedJsonViewer = lazy(() =>
  import("./virtualized-json-viewer").then((module) => ({ default: module.VirtualizedJsonViewer })),
);
const JsonScrollArea = ({ children }: { children: React.ReactNode }) => {
  return (
    <ScrollArea className="h-full min-h-0" viewportClassName="scroll-fade">
      {children}
    </ScrollArea>
  );
};
export const JsonViewer = ({ value }: { value: unknown }) => {
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
      if (formatted.length > VIRTUALIZE_MIN_CHARS) return;
      const { highlightJson } = await import("./highlight-json");
      if (gen !== genRef.current) return;
      const highlighted = await highlightJson(formatted);
      if (gen !== genRef.current) return;
      setHtml(highlighted);
    })();
  }, [value]);
  if (value === null) {
    return (
      <JsonScrollArea>
        <pre className="p-4 font-mono text-xs text-muted-foreground">{PLACEHOLDER}</pre>
      </JsonScrollArea>
    );
  }
  if (code === null) {
    return (
      <JsonScrollArea>
        <pre className="p-4 font-mono text-xs text-muted-foreground">Formatting…</pre>
      </JsonScrollArea>
    );
  }
  if (code.length > VIRTUALIZE_MIN_CHARS) {
    return (
      <Suspense
        fallback={<pre className="p-4 font-mono text-xs text-muted-foreground">Preparing…</pre>}
      >
        <VirtualizedJsonViewer code={code} />
      </Suspense>
    );
  }
  if (html === null) {
    return (
      <JsonScrollArea>
        <pre className="p-4 font-mono text-xs whitespace-pre">{code}</pre>
      </JsonScrollArea>
    );
  }
  return (
    <JsonScrollArea>
      <div
        className="[&_.shiki]:bg-transparent! [&_.shiki]:p-4 [&_.shiki]:text-xs [&_.shiki]:whitespace-pre [&_.shiki]:font-mono"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </JsonScrollArea>
  );
};
