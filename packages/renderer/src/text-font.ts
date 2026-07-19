/** CSS / canvas font-family registered from pipeline DejaVuSans.ttf. */
export const FPSR_TEXT_FONT_FAMILY = "fpsr-dejavu";

/** Fallback stack when the bundled TTF is unavailable. */
export const FPSR_TEXT_FONT_FALLBACK = "DejaVu Sans, sans-serif";

export function fpsrTextFontCss(sizePx: number): string {
  return `${sizePx}px ${FPSR_TEXT_FONT_FAMILY}, ${FPSR_TEXT_FONT_FALLBACK}`;
}
