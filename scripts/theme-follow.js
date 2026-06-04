/**
 * Theme following — Loot Roller has no theme of its own. When one of the sibling
 * Scorpious187 modules is active, Loot Roller windows adopt that module's theme so
 * the whole UI stays consistent. Priority: Quest Tracker, then Customizable Shop.
 * When neither is active, Loot Roller keeps its standard built-in styling.
 *
 * Each provider owns its theming: we call the provider's own ThemeManager, which
 * sets its `--sqt-*` / `--scs-*` vars on :root and marks our window element with a
 * `data-sqt-theme` / `data-scs-theme` attribute. Our stylesheet reads whichever
 * prefix is present (see the [data-sqt-theme]/[data-scs-theme] rules in the CSS).
 */

/** Sibling theme providers in priority order (highest first). */
const THEME_PROVIDERS = [
  { id: "scorpious187s-quest-tracker",    attr: "sqtTheme" },
  { id: "scorpious187s-customizable-shop", attr: "scsTheme" },
];

/** @returns {{id:string, attr:string, api:object}|null} The active provider, or null. */
export function resolveProvider() {
  for (const p of THEME_PROVIDERS) {
    const mod = game.modules.get(p.id);
    if (mod?.active && mod.api?.ThemeManager?.applyToElement) {
      return { ...p, api: mod.api };
    }
  }
  return null;
}

/**
 * Apply the active provider's theme to a Loot Roller window element, or clear any
 * previously-applied theme markers so the window falls back to standard styling.
 * @param {HTMLElement} el The application's root element.
 */
export function applyFollowedTheme(el) {
  if (!el) return;
  const provider = resolveProvider();

  // No provider — strip any markers a provider left behind so our base CSS applies.
  if (!provider) {
    delete el.dataset.sqtTheme;
    delete el.dataset.scsTheme;
    return;
  }

  try {
    const themeId = game.settings.get(provider.id, "theme");
    provider.api.ThemeManager.applyToElement(el, themeId);
    // Guard against a stale marker from a different provider used last render.
    for (const p of THEME_PROVIDERS) {
      if (p.attr !== provider.attr) delete el.dataset[p.attr];
    }
  } catch (err) {
    console.warn("LootRoller | theme follow failed:", err);
  }
}

/** Re-apply the followed theme to every currently-open Loot Roller window. */
export function refreshOpenWindows() {
  document.querySelectorAll(".application.loot-roller").forEach((el) => applyFollowedTheme(el));
}
