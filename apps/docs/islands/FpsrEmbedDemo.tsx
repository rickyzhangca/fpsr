import { useEffect, useId, useRef, useState } from "react";

const VIEWER_ORIGIN = "http://localhost:5173";
const EMBED_SRC = `${VIEWER_ORIGIN}/?embed=1`;

/** Sample blueprint used by the docs embed demo. */
export const DEMO_BLUEPRINT =
  "0eJyll01v4zgMhv+KwONCKeKvfBg7l5nZwwK7e9hiToPAUGw6JWpLHknOtCjy3xdyEsdTK229ubUK+eglRVLWC2yrFhtN0kL6AgWaXFNjSUlI4d4qLXbIKqrJMjKsNViwUmnWaNyjtCR3zCrFaiGfGVmsDSu1qtkW3S+5FqXFgrOfD1QhE5VRrCZLO9E5tsaxVcl+tKIi+8xy0RraSVap/NGwtjnBpNK1qFj+gMYyjcZqyp1AcwccjBTNzKrZTlPhAniCNOLwDGly4EC5kgbS7y/guKJyBlLUCCkIY7DeViR3s1rkDyRxFoJzkQU+QRocNhxcgJbwSOj+ec5kW29RQxrwM6kRxtAeZ41WeypQzzqhwKFRho6J7GTN75JO2PzOScuVtFpV2RYfxJ6UdkY56bwlm+VKFp1nhlJsKywgLUVl8HDgIx1hr0PjjxaNvS4g/LCAWhWYqTJTDWpxJAT8fXn8rCErqbKojWMaPB5Wl8Rzdjn0Fr+s9inVokYXSgAcTuUBKRwrAZz42tlYJxs+dQutK+DAZeiECz24cBouHOAiDy6ahosGuNiDi6fh4gEu8eCSabhkgFt4cItpuMUAt/TgltNwywFu5cGtpuFWA9zag1tPzd3GDYy+/LWqs21bll2FW916W/dSUdu2epyRNKgt6uuTI+gatyB9bKkuEW+1cd+eToGnf51tSdrYbDQeL5mYw3FYGCu6SOevsvA7HHzBxR8NLhwE5+FcCts7sUe44ISLrg45jaLISO40FoTSng/InV5Ozevgz8vZqBrcgf8k3V0P3wMe8IgHmw2/eB+Hm33umFRAH8lXNKSxYP+iaSs3qN3V9SrlXsc/e9UsGLt1S73FTJWToeEYGt4MjcbQ6GZoPIbGN0OTMTS5GboYQxc3Q5dj6PJm6GoMXf0/6LfzZ+L5A/Kv7gPy/jhlRrusP77LaSzw8x8pJPPLvr9s947b0Evkj+zvtrLUVNSZ7YUmNzshhae3OYG/O9mX7mLgUCpdt5VwEc0zCn57Ag4FNigLdOP0OHre4If+Rr3CDyfzI3/PXuFHk/mxv32v8OPJ/MTfyVf4yWT+wt/UV/iLD/OVnZ1KXJO53NH9vstBN/3z7f6Pr/4yfA+zGmM2HNxLzd3M/cuPQyW2WEEKX9ybzb3OPqOknXS9gNp092uyCNfxep3EQRyGQXA4/AcQnrsL";

type Status = "loading" | "ready" | "loaded" | "error";

export default function FpsrEmbedDemo() {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const titleId = useId();
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== VIEWER_ORIGIN) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;

      const type = (data as { type?: unknown }).type;
      if (type === "fpsr:ready") {
        setStatus("ready");
        setError(null);
        event.source?.postMessage(
          { type: "fpsr:load", version: 1, blueprint: DEMO_BLUEPRINT },
          { targetOrigin: VIEWER_ORIGIN },
        );
        return;
      }
      if (type === "fpsr:loaded") {
        setStatus("loaded");
        setError(null);
        return;
      }
      if (type === "fpsr:error") {
        const message =
          typeof (data as { message?: unknown }).message === "string"
            ? (data as { message: string }).message
            : "Embed load failed.";
        setStatus("error");
        setError(message);
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const statusLabel =
    status === "loading"
      ? "Loading viewer…"
      : status === "ready"
        ? "Sending blueprint…"
        : status === "loaded"
          ? "Loaded"
          : "Error";

  return (
    <figure
      aria-labelledby={titleId}
      style={{
        margin: "1.5rem 0",
        border: "1px solid var(--border, #e5e5e5)",
        borderRadius: "0.75rem",
        overflow: "hidden",
        background: "var(--card, #fafafa)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
          padding: "0.6rem 0.9rem",
          borderBottom: "1px solid var(--border, #e5e5e5)",
          fontSize: "0.8125rem",
        }}
      >
        <span id={titleId} style={{ fontWeight: 600 }}>
          Live embed
        </span>
        <span style={{ color: "var(--muted-foreground, #737373)" }} aria-live="polite">
          {statusLabel}
          {error ? ` — ${error}` : ""}
        </span>
      </div>
      <iframe
        ref={iframeRef}
        src={EMBED_SRC}
        title="FPSR blueprint embed demo"
        loading="lazy"
        style={{
          display: "block",
          width: "100%",
          height: "420px",
          border: 0,
          background: "#0a0a0a",
        }}
      />
    </figure>
  );
}
