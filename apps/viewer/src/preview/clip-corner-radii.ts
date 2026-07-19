export type CornerRadii = {
  tl: number;
  tr: number;
  br: number;
  bl: number;
};

const ZERO_RADII: CornerRadii = { tl: 0, tr: 0, br: 0, bl: 0 };

/** Parse the first px length from a CSS border-*-radius value (ignores elliptical second axis). */
export const parseCssRadiusPx = (value: string): number => {
  const match = value.trim().match(/^(-?[\d.]+)px/);
  return match ? Math.max(0, Number(match[1])) : 0;
};

/**
 * Walk ancestors for the nearest element that both clips overflow and has a
 * non-zero border radius — typically the rounded card wrapping the preview.
 */
export const findRoundedClipAncestor = (element: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    const cs = getComputedStyle(node);
    const clips =
      cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible";
    const tl = parseCssRadiusPx(cs.borderTopLeftRadius);
    const tr = parseCssRadiusPx(cs.borderTopRightRadius);
    const br = parseCssRadiusPx(cs.borderBottomRightRadius);
    const bl = parseCssRadiusPx(cs.borderBottomLeftRadius);
    if (clips && (tl > 0 || tr > 0 || br > 0 || bl > 0)) return node;
    node = node.parentElement;
  }
  return null;
};

/**
 * Corner radii for `element` so a border drawn on it follows the visible clip of
 * a rounded ancestor. Uses the nested-radius rule: max(0, parentRadius - inset).
 */
export const effectiveClipCornerRadii = (element: HTMLElement): CornerRadii => {
  const clip = findRoundedClipAncestor(element);
  if (!clip) return ZERO_RADII;
  const cs = getComputedStyle(clip);
  const parent: CornerRadii = {
    tl: parseCssRadiusPx(cs.borderTopLeftRadius),
    tr: parseCssRadiusPx(cs.borderTopRightRadius),
    br: parseCssRadiusPx(cs.borderBottomRightRadius),
    bl: parseCssRadiusPx(cs.borderBottomLeftRadius),
  };
  const er = element.getBoundingClientRect();
  const cr = clip.getBoundingClientRect();
  const insetL = er.left - cr.left;
  const insetT = er.top - cr.top;
  const insetR = cr.right - er.right;
  const insetB = cr.bottom - er.bottom;
  return {
    tl: Math.max(0, parent.tl - Math.max(insetL, insetT)),
    tr: Math.max(0, parent.tr - Math.max(insetR, insetT)),
    br: Math.max(0, parent.br - Math.max(insetR, insetB)),
    bl: Math.max(0, parent.bl - Math.max(insetL, insetB)),
  };
};

export const cornerRadiiToCss = (radii: CornerRadii): string =>
  `${radii.tl}px ${radii.tr}px ${radii.br}px ${radii.bl}px`;
