// @vitest-environment jsdom
import { createStore } from "jotai";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_PREVIEW_PREFERENCES,
  VIEWER_PREFERENCE_KEYS,
  activeTabAtom,
  previewPreferencesAtom,
  summaryExpandedAtom,
} from "./viewer-preferences";

describe("viewer preferences", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores a persisted value in a fresh store", () => {
    const firstStore = createStore();
    const unsubscribeFirst = firstStore.sub(summaryExpandedAtom, () => {});
    firstStore.set(summaryExpandedAtom, false);

    expect(localStorage.getItem(VIEWER_PREFERENCE_KEYS.summaryExpanded)).toBe("false");
    unsubscribeFirst();

    const secondStore = createStore();
    const unsubscribeSecond = secondStore.sub(summaryExpandedAtom, () => {});
    expect(secondStore.get(summaryExpandedAtom)).toBe(false);
    unsubscribeSecond();
  });

  it("falls back to defaults when persisted JSON has an invalid shape", () => {
    localStorage.setItem(
      VIEWER_PREFERENCE_KEYS.preview,
      JSON.stringify({ ...DEFAULT_PREVIEW_PREFERENCES, limitTo4k: "yes" }),
    );

    const store = createStore();
    const unsubscribe = store.sub(previewPreferencesAtom, () => {});
    expect(store.get(previewPreferencesAtom)).toEqual(DEFAULT_PREVIEW_PREFERENCES);
    unsubscribe();
  });

  it("defaults backgroundMode to auto", () => {
    expect(DEFAULT_PREVIEW_PREFERENCES.backgroundMode).toBe("auto");

    const store = createStore();
    const unsubscribe = store.sub(previewPreferencesAtom, () => {});
    expect(store.get(previewPreferencesAtom).backgroundMode).toBe("auto");
    unsubscribe();
  });

  it("accepts persisted auto backgroundMode", () => {
    localStorage.setItem(
      VIEWER_PREFERENCE_KEYS.preview,
      JSON.stringify({
        ...DEFAULT_PREVIEW_PREFERENCES,
        backgroundMode: "auto",
      }),
    );

    const store = createStore();
    const unsubscribe = store.sub(previewPreferencesAtom, () => {});
    expect(store.get(previewPreferencesAtom).backgroundMode).toBe("auto");
    unsubscribe();
  });

  it("migrates legacy showCheckerboard into showBackground", () => {
    localStorage.setItem(
      VIEWER_PREFERENCE_KEYS.preview,
      JSON.stringify({
        limitTo4k: true,
        exportFormat: "webp",
        altMode: true,
        showCoords: false,
        showCheckerboard: false,
      }),
    );

    const store = createStore();
    const unsubscribe = store.sub(previewPreferencesAtom, () => {});
    expect(store.get(previewPreferencesAtom)).toEqual({
      limitTo4k: true,
      exportFormat: "webp",
      altMode: true,
      showCoords: false,
      showBackground: false,
      backgroundMode: "checkerboard",
      orbitPlanet: "nauvis",
    });
    unsubscribe();
  });

  it("migrates transparent backgroundMode into showBackground off", () => {
    localStorage.setItem(
      VIEWER_PREFERENCE_KEYS.preview,
      JSON.stringify({
        limitTo4k: true,
        exportFormat: "webp",
        altMode: true,
        showCoords: false,
        backgroundMode: "transparent",
      }),
    );

    const store = createStore();
    const unsubscribe = store.sub(previewPreferencesAtom, () => {});
    expect(store.get(previewPreferencesAtom)).toEqual({
      limitTo4k: true,
      exportFormat: "webp",
      altMode: true,
      showCoords: false,
      showBackground: false,
      backgroundMode: "checkerboard",
      orbitPlanet: "nauvis",
    });
    unsubscribe();
  });

  it("migrates nauvis-orbit into orbit + orbitPlanet", () => {
    localStorage.setItem(
      VIEWER_PREFERENCE_KEYS.preview,
      JSON.stringify({
        limitTo4k: true,
        exportFormat: "webp",
        altMode: true,
        showCoords: false,
        showBackground: true,
        backgroundMode: "nauvis-orbit",
      }),
    );

    const store = createStore();
    const unsubscribe = store.sub(previewPreferencesAtom, () => {});
    expect(store.get(previewPreferencesAtom)).toEqual({
      limitTo4k: true,
      exportFormat: "webp",
      altMode: true,
      showCoords: false,
      showBackground: true,
      backgroundMode: "orbit",
      orbitPlanet: "nauvis",
    });
    unsubscribe();
  });

  it("falls back to Preview when the removed Compare tab was persisted", () => {
    localStorage.setItem(VIEWER_PREFERENCE_KEYS.activeTab, JSON.stringify("compare"));

    const store = createStore();
    const unsubscribe = store.sub(activeTabAtom, () => {});
    expect(store.get(activeTabAtom)).toBe("preview");
    unsubscribe();
  });
});
