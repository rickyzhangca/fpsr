import { AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { formatJson } from "./formatJson";

const PLACEHOLDER = "// decode a blueprint to inspect JSON";
const HIGHLIGHT_MAX_CHARS = 200_000;
const INITIAL_DISPLAY_MAX_CHARS = 500_000;

const compactCount = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function JsonViewer({ value }: { value: unknown }) {
  const [code, setCode] = useState<string | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);
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
    setShowFull(false);

    void (async () => {
      const formatted = await formatJson(value);
      if (gen !== genRef.current) return;
      setCode(formatted);

      if (formatted.length > HIGHLIGHT_MAX_CHARS) return;
      const { highlightJson } = await import("./highlightJson");
      if (gen !== genRef.current) return;
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

  const truncated = !showFull && code.length > INITIAL_DISPLAY_MAX_CHARS;
  const visibleCode = truncated ? code.slice(0, INITIAL_DISPLAY_MAX_CHARS) : code;

  if (code.length > HIGHLIGHT_MAX_CHARS) {
    return (
      <div className="">
        {truncated && (
          <div className="px-3 pt-2">
            <AlertDescription className="flex text-xs items-center justify-between gap-3">
              <span>
                Showing {compactCount.format(INITIAL_DISPLAY_MAX_CHARS)}/
                {compactCount.format(code.length)} chars
              </span>
              <Button variant="link" size="xs" onClick={() => setShowFull(true)}>
                Show full
              </Button>
            </AlertDescription>
          </div>
        )}
        <pre className="font-mono text-xs wrap-break-word whitespace-pre-wrap">
          {visibleCode}
          {truncated ? "\n…" : ""}
        </pre>
      </div>
    );
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
