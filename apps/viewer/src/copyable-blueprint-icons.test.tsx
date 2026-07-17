// @vitest-environment jsdom
import { encode, type Blueprint, type BlueprintBook } from "fpsr";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const toastSuccess = vi.fn();
const toastError = vi.fn();
const clipboardWriteText = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("./factorio-item-icon", () => ({
  FactorioItemIcon: ({ iconKey }: { iconKey: string | string[] }) => {
    const key = Array.isArray(iconKey) ? iconKey[0] : iconKey;
    return <span data-testid="entity-icon" data-icon-key={key} />;
  },
}));

vi.mock("./viewer-assets", () => ({
  viewerAssets: {
    loadRenderDb: vi.fn().mockResolvedValue({ tiles: {} }),
  },
}));

import { BlueprintSummary } from "./blueprint-summary";
import { BookSummary } from "./book-summary";
import { CopyableBlueprintIcons } from "./copyable-blueprint-icons";

describe("CopyableBlueprintIcons", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    toastSuccess.mockReset();
    toastError.mockReset();
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    host.remove();
  });

  it("copies the string from getBlueprintString on click", async () => {
    const root = createRoot(host);
    act(() => {
      root.render(<CopyableBlueprintIcons getBlueprintString={() => "0abc"} />);
    });
    const button = host.querySelector('[aria-label="Copy blueprint string"]');
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clipboardWriteText).toHaveBeenCalledWith("0abc");
    expect(toastSuccess).toHaveBeenCalledWith("Blueprint string copied");
    act(() => root.unmount());
  });

  it("toasts an error when clipboard write fails", async () => {
    clipboardWriteText.mockRejectedValue(new Error("denied"));
    const root = createRoot(host);
    act(() => {
      root.render(<CopyableBlueprintIcons getBlueprintString={() => "0abc"} />);
    });
    await act(async () => {
      host
        .querySelector('[aria-label="Copy blueprint string"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(toastError).toHaveBeenCalledWith("denied");
    act(() => root.unmount());
  });
});

describe("BlueprintSummary copy", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    toastSuccess.mockReset();
    toastError.mockReset();
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    host.remove();
  });

  const blueprint: Blueprint = {
    item: "blueprint",
    version: 0,
    label: "Copy me",
    entities: [],
  };

  it("reuses sourceString when provided", async () => {
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintSummary blueprint={blueprint} tileSize="—" sourceString="0original" />);
    });
    await act(async () => {
      host
        .querySelector('[aria-label="Copy blueprint string"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clipboardWriteText).toHaveBeenCalledWith("0original");
    act(() => root.unmount());
  });

  it("encodes the blueprint when sourceString is missing", async () => {
    const root = createRoot(host);
    act(() => {
      root.render(<BlueprintSummary blueprint={blueprint} tileSize="—" />);
    });
    await act(async () => {
      host
        .querySelector('[aria-label="Copy blueprint string"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clipboardWriteText).toHaveBeenCalledWith(encode({ blueprint }));
    act(() => root.unmount());
  });
});

describe("BookSummary copy", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as {
        IS_REACT_ACT_ENVIRONMENT?: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    toastSuccess.mockReset();
    toastError.mockReset();
    clipboardWriteText.mockReset();
    clipboardWriteText.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    host.remove();
  });

  const book: BlueprintBook = {
    item: "blueprint-book",
    version: 0,
    label: "Copy book",
    blueprints: [],
  };

  it("reuses sourceString when provided", async () => {
    const root = createRoot(host);
    act(() => {
      root.render(<BookSummary book={book} sourceString="0book-original" />);
    });
    await act(async () => {
      host
        .querySelector('[aria-label="Copy blueprint string"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clipboardWriteText).toHaveBeenCalledWith("0book-original");
    act(() => root.unmount());
  });

  it("encodes the book when sourceString is missing", async () => {
    const root = createRoot(host);
    act(() => {
      root.render(<BookSummary book={book} />);
    });
    await act(async () => {
      host
        .querySelector('[aria-label="Copy blueprint string"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(clipboardWriteText).toHaveBeenCalledWith(encode({ blueprint_book: book }));
    act(() => root.unmount());
  });
});
