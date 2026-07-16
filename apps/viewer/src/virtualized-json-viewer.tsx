import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollBar,
} from "@/components/ui/scroll-area";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type ListRange, type ScrollerProps } from "react-virtuoso";
import { highlightJsonPage } from "./json-highlight-client";
import type { JsonHighlightToken } from "./json-highlight-protocol";
import {
  buildLineStarts,
  JSON_HIGHLIGHT_PAGE_LINES,
  jsonLineAt,
  jsonPageCode,
  jsonPagesForRange,
} from "./json-lines";

const LINE_HEIGHT_PX = 20;
const RANGE_SETTLE_MS = 50;
const MAX_CACHED_PAGES = 32;
const EMPTY_PAGES = new Map<number, JsonHighlightToken[][]>();

interface PageCache {
  code: string;
  pages: Map<number, JsonHighlightToken[][]>;
}

type VirtualizedJsonScrollerProps = ScrollerProps & {
  "aria-label"?: string;
  className?: string;
};

const VirtualizedJsonScroller = forwardRef<HTMLDivElement, VirtualizedJsonScrollerProps>(
  ({ children, className, style, ...props }, ref) => (
    <ScrollAreaRoot className={className}>
      <ScrollAreaViewport ref={ref} style={style} {...props}>
        {children}
      </ScrollAreaViewport>
      <ScrollBar />
      <ScrollBar orientation="horizontal" />
      <ScrollAreaCorner />
    </ScrollAreaRoot>
  ),
);

const VIRTUOSO_COMPONENTS = { Scroller: VirtualizedJsonScroller };

function trimPageCache(pages: Map<number, JsonHighlightToken[][]>): void {
  while (pages.size > MAX_CACHED_PAGES) {
    const oldest = pages.keys().next().value;
    if (oldest === undefined) return;
    pages.delete(oldest);
  }
}

function HighlightedLine({ tokens }: { tokens: JsonHighlightToken[] }) {
  return tokens.map((token, index) => (
    <span
      key={`${index}:${token.content}`}
      style={token.color ? { color: token.color } : undefined}
    >
      {token.content}
    </span>
  ));
}

export function VirtualizedJsonViewer({ code }: { code: string }) {
  const lineStarts = useMemo(() => buildLineStarts(code), [code]);
  const [cache, setCache] = useState<PageCache>(() => ({ code, pages: new Map() }));
  const pendingPagesRef = useRef(new Set<string>());
  const latestRangeRef = useRef<ListRange | null>(null);
  const scrollingRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);
  const codeRef = useRef(code);
  const generationRef = useRef(0);

  if (codeRef.current !== code) {
    codeRef.current = code;
    generationRef.current++;
    pendingPagesRef.current.clear();
  }

  const pages = cache.code === code ? cache.pages : EMPTY_PAGES;

  const requestRange = useCallback(
    (range: ListRange) => {
      const generation = generationRef.current;
      for (const pageIndex of jsonPagesForRange(
        range.startIndex,
        range.endIndex,
        lineStarts.length,
      )) {
        if (pages.has(pageIndex)) continue;
        const pendingKey = `${generation}:${pageIndex}`;
        if (pendingPagesRef.current.has(pendingKey)) continue;
        pendingPagesRef.current.add(pendingKey);

        const pageCode = jsonPageCode(code, lineStarts, pageIndex);
        void highlightJsonPage(pageCode)
          .then((lines) => {
            if (generation !== generationRef.current) return;
            setCache((previous) => {
              const nextPages = previous.code === code ? new Map(previous.pages) : new Map();
              nextPages.delete(pageIndex);
              nextPages.set(pageIndex, lines);
              trimPageCache(nextPages);
              return { code, pages: nextPages };
            });
          })
          .catch(() => {
            // Highlighting is progressive enhancement; plain text remains visible.
          })
          .finally(() => {
            pendingPagesRef.current.delete(pendingKey);
          });
      }
    },
    [code, lineStarts, pages],
  );

  const scheduleRange = useCallback(
    (delay = RANGE_SETTLE_MS) => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined;
        const range = latestRangeRef.current;
        if (range && !scrollingRef.current) requestRange(range);
      }, delay);
    },
    [requestRange],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return (
    <Virtuoso
      aria-label="JSON source"
      className="h-full min-h-0"
      components={VIRTUOSO_COMPONENTS}
      totalCount={lineStarts.length}
      fixedItemHeight={LINE_HEIGHT_PX}
      increaseViewportBy={{ top: 200, bottom: 400 }}
      rangeChanged={(range) => {
        latestRangeRef.current = range;
        if (!scrollingRef.current) scheduleRange();
      }}
      isScrolling={(scrolling) => {
        scrollingRef.current = scrolling;
        if (!scrolling) scheduleRange(0);
      }}
      itemContent={(lineIndex) => {
        const pageIndex = Math.floor(lineIndex / JSON_HIGHLIGHT_PAGE_LINES);
        const pageLineIndex = lineIndex - pageIndex * JSON_HIGHLIGHT_PAGE_LINES;
        const tokens = pages.get(pageIndex)?.[pageLineIndex];
        return (
          <div
            data-json-line={lineIndex}
            className="h-5 min-w-max px-4 font-mono text-xs leading-5 whitespace-pre"
          >
            {tokens ? <HighlightedLine tokens={tokens} /> : jsonLineAt(code, lineStarts, lineIndex)}
          </div>
        );
      }}
    />
  );
}
