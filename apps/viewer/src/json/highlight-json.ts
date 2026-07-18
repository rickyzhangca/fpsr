import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { JsonHighlightToken } from "./json-highlight-protocol";
const highlighterPromise = createHighlighterCore({
  themes: [import("@shikijs/themes/dark-plus")],
  langs: [import("@shikijs/langs/json")],
  engine: createJavaScriptRegexEngine(),
});
export const highlightJson = async (code: string): Promise<string> => {
  const highlighter = await highlighterPromise;
  return highlighter.codeToHtml(code, { lang: "json", theme: "dark-plus" });
};
export const tokenizeJson = async (code: string): Promise<JsonHighlightToken[][]> => {
  const highlighter = await highlighterPromise;
  return highlighter
    .codeToTokensBase(code, { lang: "json", theme: "dark-plus" })
    .map((line) => line.map(({ content, color }) => ({ content, color })));
};
