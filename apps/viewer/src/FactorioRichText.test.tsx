// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./FactorioItemIcon", () => ({
  FactorioItemIcon: ({
    iconKey,
    quality,
    title,
  }: {
    iconKey: string | string[];
    quality?: string;
    title?: string;
  }) => {
    const key = Array.isArray(iconKey) ? iconKey.join("|") : iconKey;
    return (
      <span
        data-testid="rich-icon"
        data-icon-key={key}
        data-quality={quality ?? ""}
        title={title}
      />
    );
  },
}));

import { FactorioRichText } from "./FactorioRichText";

describe("FactorioRichText", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    host.remove();
  });

  it("renders icon tokens and trailing text", async () => {
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <FactorioRichText text="[item=turbo-transport-belt,quality=epic] test" size="lg" />,
      );
    });

    const icon = host.querySelector("[data-testid=rich-icon]");
    expect(icon?.getAttribute("data-icon-key")).toBe(
      "item/turbo-transport-belt|entity/turbo-transport-belt|recipe/turbo-transport-belt",
    );
    expect(icon?.getAttribute("data-quality")).toBe("epic");
    expect(host.textContent).toContain(" test");

    await act(async () => root.unmount());
  });

  it("uses fallback for empty text", async () => {
    const root = createRoot(host);
    await act(async () => {
      root.render(<FactorioRichText fallback="No description" />);
    });

    expect(host.textContent).toBe("No description");

    await act(async () => root.unmount());
  });
});
