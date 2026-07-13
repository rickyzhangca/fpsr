import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

const highlighterPromise = createHighlighterCore({
  themes: [import("@shikijs/themes/dark-plus")],
  langs: [import("@shikijs/langs/json")],
  engine: createJavaScriptRegexEngine(),
});

export async function highlightJson(code: string): Promise<string> {
  const highlighter = await highlighterPromise;
  return highlighter.codeToHtml(code, { lang: "json", theme: "dark-plus" });
}
