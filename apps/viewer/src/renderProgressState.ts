import type { PreviewRenderProgress } from "./renderWorkerProtocol";

export interface RenderSelection {
  sourceId: string;
  path: number[] | null;
}

export interface ActiveRenderProgress extends PreviewRenderProgress, RenderSelection {}

export function sameRenderPath(a: number[] | null, b: number[] | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function updateActiveRenderProgress(
  previous: ActiveRenderProgress | null,
  progress: PreviewRenderProgress | null,
  selection: RenderSelection,
): ActiveRenderProgress | null {
  const isCurrentSelection =
    previous?.sourceId === selection.sourceId && sameRenderPath(previous.path, selection.path);

  if (!progress) return isCurrentSelection ? null : previous;

  if (
    isCurrentSelection &&
    previous.value === progress.value &&
    previous.label === progress.label &&
    previous.durationMs === progress.durationMs
  ) {
    return previous;
  }

  return { ...selection, ...progress };
}
