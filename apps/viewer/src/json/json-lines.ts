export const JSON_HIGHLIGHT_PAGE_LINES = 256;
export const buildLineStarts = (code: string): number[] => {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
};
export const jsonLineAt = (code: string, starts: readonly number[], index: number): string => {
  if (index < 0 || index >= starts.length) return "";
  const start = starts[index] ?? 0;
  let end = starts[index + 1] ?? code.length;
  if (end > start && code.charCodeAt(end - 1) === 10) end--;
  if (end > start && code.charCodeAt(end - 1) === 13) end--;
  return code.slice(start, end);
};
export const jsonPageCode = (
  code: string,
  starts: readonly number[],
  pageIndex: number,
  pageLines = JSON_HIGHLIGHT_PAGE_LINES,
): string => {
  const firstLine = pageIndex * pageLines;
  const lastLine = Math.min(starts.length, firstLine + pageLines);
  const lines: string[] = [];
  for (let line = firstLine; line < lastLine; line++) {
    lines.push(jsonLineAt(code, starts, line));
  }
  return lines.join("\n");
};
export const jsonPagesForRange = (
  startIndex: number,
  endIndex: number,
  lineCount: number,
  pageLines = JSON_HIGHLIGHT_PAGE_LINES,
): number[] => {
  if (lineCount <= 0) return [];
  const maxPage = Math.floor((lineCount - 1) / pageLines);
  const firstPage = Math.min(maxPage, Math.floor(Math.max(0, startIndex) / pageLines));
  const lastPage = Math.min(maxPage, Math.floor(Math.max(startIndex, endIndex) / pageLines));
  const pages: number[] = [];
  for (let page = firstPage; page <= lastPage; page++) pages.push(page);
  if (firstPage > 0) pages.push(firstPage - 1);
  if (lastPage < maxPage) pages.push(lastPage + 1);
  return pages;
};
