"use client";

/**
 * Resolves once the first-visit splash has lifted (or right away when there is none), so heavy page work (pins,
 * scroll timelines) waits instead of competing with the splash for frames. The splash removes html.splashing and
 * dispatches `arclaw:splash-done` when it finishes.
 */
export const SPLASH_DONE = "arclaw:splash-done";

export function whenSplashDone(): Promise<void> {
  if (typeof document === "undefined" || !document.documentElement.classList.contains("splashing")) return Promise.resolve();
  return new Promise((resolve) => window.addEventListener(SPLASH_DONE, () => resolve(), { once: true }));
}
