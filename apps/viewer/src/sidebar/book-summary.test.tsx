// @vitest-environment jsdom
import { encodedBookByteSize, formatByteSize } from "@/blueprint/blueprint-meta";
import type { BlueprintBook } from "@rickyzhangca/fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { BookSummary } from "./book-summary";
vi.mock("@/blueprint/factorio-item-icon", () => ({
  FactorioItemIcon: ({ iconKey }: { iconKey: string | string[] }) => {
    const key = Array.isArray(iconKey) ? iconKey[0] : iconKey;
    return <span data-testid="entity-icon" data-icon-key={key} />;
  },
}));
describe("BookSummary", () => {
  let host: HTMLDivElement;
  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });
  afterEach(() => {
    host.remove();
  });
  it("shows book name, description, and byte size", () => {
    const book: BlueprintBook = {
      item: "blueprint-book",
      version: 0,
      label: "Meta book",
      description: "A test book",
      blueprints: [],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BookSummary book={book} />);
    });
    const text = host.textContent ?? "";
    expect(text).toContain("Meta book");
    expect(text).toContain("A test book");
    expect(text).toContain("Byte size");
    expect(text).toContain(formatByteSize(encodedBookByteSize(book)));
    expect(text).not.toContain("Version");
    expect(text).not.toContain("Snapping");
    expect(text).not.toContain("Components");
    expect(host.querySelector('[aria-label="Blueprint icons"]')).toBeTruthy();
    const icons = [...host.querySelectorAll("[data-testid=entity-icon]")];
    expect(icons.map((el) => el.getAttribute("data-icon-key"))).toEqual(["item/blueprint-book"]);
    act(() => root.unmount());
  });

  it("uses the first entry composite for the cover instead of book.icons", () => {
    const book: BlueprintBook = {
      item: "blueprint-book",
      version: 0,
      label: "Cover from child",
      icons: [{ index: 1, signal: { type: "item", name: "iron-plate" } }],
      blueprints: [
        {
          index: 0,
          upgrade_planner: {
            item: "upgrade-planner",
            version: 0,
            settings: {
              mappers: [
                {
                  index: 0,
                  from: { type: "entity", name: "transport-belt" },
                  to: { type: "entity", name: "fast-transport-belt" },
                },
              ],
            },
          },
        },
      ],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BookSummary book={book} />);
    });
    const icons = [...host.querySelectorAll("[data-testid=entity-icon]")];
    expect(icons.map((el) => el.getAttribute("data-icon-key"))).toEqual([
      "item/blueprint-book",
      "item/upgrade-planner",
      "entity/fast-transport-belt",
    ]);
    act(() => root.unmount());
  });
  it("shows fallback when description is missing", () => {
    const book: BlueprintBook = {
      item: "blueprint-book",
      version: 0,
      label: "No desc",
      blueprints: [],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BookSummary book={book} />);
    });
    expect(host.textContent).toContain("No description");
    act(() => root.unmount());
  });
  it("uses exact sourceBytes when provided", () => {
    const book: BlueprintBook = {
      item: "blueprint-book",
      version: 0,
      label: "Exact",
      blueprints: [],
    };
    const root = createRoot(host);
    act(() => {
      root.render(<BookSummary book={book} sourceBytes={2048} />);
    });
    expect(host.textContent).toContain(formatByteSize(2048));
    act(() => root.unmount());
  });
});
