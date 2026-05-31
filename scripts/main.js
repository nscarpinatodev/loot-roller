/**
 * Loot Roller — Module Entry Point
 *
 * Wires up:
 *  - Module settings (global + system-specific via adapter.getSettings())
 *  - Socket handlers
 *  - Toolbar button (GM only)
 *  - Global API exposure (window.LootRoller)
 *  - App class registry on the module object
 */

import { LootRoller } from "./api.js";
import { registerSocketHandlers } from "./socket.js";
import { CompendiumHelper } from "./compendium-helper.js";
import { LootHubApp }             from "./apps/loot-hub-app.js";
import { LootRollerApp }          from "./apps/loot-roller-app.js";
import { LotterySetupApp }        from "./apps/lottery-setup-app.js";
import { LotteryPlayerApp }       from "./apps/lottery-player-app.js";
import { LotteryGMApp }           from "./apps/lottery-gm-app.js";
import { PartyStashConfigApp }    from "./apps/party-stash-config-app.js";
import { QuestGeneratorApp }      from "./apps/quest-generator-app.js";
import { ShopGeneratorApp }       from "./apps/shop-generator-app.js";
import { SavedListsApp }          from "./apps/saved-lists-app.js";
import { CompendiumSettingsApp }  from "./apps/compendium-settings-app.js";

// System adapters — only one will self-register based on game.system.id
import "./systems/dnd5e-adapter.js";
import "./systems/pf2e-adapter.js";
import "./systems/fallout-adapter.js";

const MODULE_ID = "loot-roller";

// ── init ─────────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  // ── Global settings ──────────────────────────────────────────────────────
  game.settings.registerMenu(MODULE_ID, "compendiumSources", {
    name: "LOOTROLLER.settings.compendiumSources.name",
    label: "LOOTROLLER.settings.compendiumSources.label",
    hint: "LOOTROLLER.settings.compendiumSources.hint",
    icon: "fa-solid fa-book",
    type: CompendiumSettingsApp,
    restricted: true,
  });

  game.settings.register(MODULE_ID, "compendiumPacks", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.registerMenu(MODULE_ID, "partyStashConfig", {
    name: "LOOTROLLER.settings.partyStashConfig.name",
    label: "LOOTROLLER.settings.partyStashConfig.label",
    hint: "LOOTROLLER.settings.partyStashConfig.hint",
    icon: "fa-solid fa-box",
    type: PartyStashConfigApp,
    restricted: true,
  });

  game.settings.register(MODULE_ID, "partyStashActor", {
    name: "LOOTROLLER.settings.partyStashActor.name",
    hint: "LOOTROLLER.settings.partyStashActor.hint",
    scope: "world",
    config: false,
    type: String,
    default: "",
  });

  game.settings.register(MODULE_ID, "currencyDistribution", {
    name: "LOOTROLLER.settings.currencyDistribution.name",
    hint: "LOOTROLLER.settings.currencyDistribution.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      equal: "LOOTROLLER.settings.currencyDistribution.equal",
      stash:  "LOOTROLLER.settings.currencyDistribution.stash",
    },
    default: "equal",
  });

  game.settings.register(MODULE_ID, "savedLists", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "lotteryTimeout", {
    name: "LOOTROLLER.settings.lotteryTimeout.name",
    hint: "LOOTROLLER.settings.lotteryTimeout.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 300, step: 5 },
    default: 60,
  });

  // Registered in init but adapter.getSettings() is called after ready when
  // game.i18n is available. We defer system settings to ready.

  // ── Socket ───────────────────────────────────────────────────────────────
  registerSocketHandlers();

  // ── Handlebars partials / helpers ─────────────────────────────────────────
  Handlebars.registerHelper("lootrollerEq", (a, b) => a === b);
  Handlebars.registerHelper("lootrollerIncludes", (arr, val) => Array.isArray(arr) && arr.includes(val));
  Handlebars.registerHelper("lootrollerRarityClass", (rarity) =>
    (rarity ?? "")
      .replace(/([A-Z])/g, (c) => `-${c.toLowerCase()}`) // camelCase → kebab
      .replace(/\s+/g, "-")
      .toLowerCase()
  );
  // Returns true when the active system uses party-level filtering instead of rarity buttons.
  // Checked at render time so it always reflects the current system.
  Handlebars.registerHelper("lootrollerUsesPartyLevel", () => {
    if (typeof game === "undefined") return false;
    // Primary: ask the adapter (extensible for future systems)
    const adapter = LootRoller.getAdapter?.();
    if (adapter?.getItemLevelRange) return true;
    // Fallback: hardcoded system check so PF2e works even if the adapter JS is cached
    return game.system?.id === "pf2e";
  });
});

// ── ready ─────────────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  // ── Expose global API ────────────────────────────────────────────────────
  window.LootRoller = LootRoller;

  // ── Store app constructors on module for cross-file access ───────────────
  const mod = game.modules.get(MODULE_ID);
  mod.apps = { LootHubApp, LootRollerApp, LotterySetupApp, LotteryPlayerApp, LotteryGMApp, QuestGeneratorApp, ShopGeneratorApp, SavedListsApp, CompendiumSettingsApp };
  mod.api  = LootRoller;

  // ── Register adapter-specific settings (i18n is ready now) ───────────────
  const adapter = LootRoller.getAdapter();
  if (adapter?.getSettings) {
    for (const cfg of adapter.getSettings()) {
      const { key, ...rest } = cfg;
      if (!game.settings.settings.has(`${MODULE_ID}.${key}`)) {
        game.settings.register(MODULE_ID, key, rest);
      }
    }
  }

  // ── Pre-warm compendium indexes / pool ───────────────────────────────────
  // Prefer adapter.warmPool() (each adapter knows which cache to build).
  // Fall back to plain CompendiumHelper.getIndex for adapters that lack warmPool.
  if (adapter?.warmPool) {
    adapter.warmPool().catch(() => {});
  } else if (adapter?.getCompendiumPacks) {
    for (const packId of adapter.getCompendiumPacks()) {
      CompendiumHelper.getIndex(packId).catch(() => {});
    }
  }

  console.log(`Loot Roller | Ready. Adapter: ${adapter?.systemName ?? "none"}`);

  // ── PF2e filter injection (cache-bypass) ────────────────────────────────
  // Runs from main.js (always reloaded when module version changes) so the
  // correct filter UI and roll behaviour work even if app JS is still cached.
  _registerPf2eFilterHooks();
});

/**
 * Register render hooks for Quest and Shop generators.
 * When the adapter provides `getFilterFields()`, the hook:
 *   1. Injects the correct filter UI if the old template rendered rarity buttons
 *   2. Patches _rollItem / _generate to pass the right params to findItems
 */
function _registerPf2eFilterHooks() {
  const _inject = (app) => {
    const el = app.element;
    if (!el) return;

    const adapter = LootRoller.getAdapter?.();
    if (!adapter?.getFilterFields) return;

    // Ensure party level is initialised on the app instance
    if (app._partyLevel === undefined || app._partyLevel === null) {
      app._partyLevel = adapter.getItemLevelRange?.()?.default ?? 5;
    }

    // Only inject UI if the template didn't already render a number field
    // (i.e. the template is a cached old version with rarity buttons only)
    if (!el.querySelector(".filter-number-field")) {
      const state  = { selectedRarities: app._rarities, partyLevel: app._partyLevel };
      const fields = adapter.getFilterFields(state);
      const numField = fields?.find((f) => f.type === "number");
      if (numField) {
        // Replace the first rarity filter group with the number input
        const rarityGroup = el.querySelector(".filter-group:has(.rarity-btn)")
          ?? el.querySelectorAll(".filter-group")[0];
        if (rarityGroup) {
          rarityGroup.innerHTML = `
            <label class="filter-label">${game.i18n.localize(numField.label)}</label>
            <div class="party-level-input">
              <input type="number" class="filter-number-field"
                data-filter-key="${numField.key}"
                value="${app._partyLevel}" min="${numField.min}" max="${numField.max}" />
            </div>`;
          rarityGroup.querySelector(".filter-number-field")?.addEventListener("change", (e) => {
            app._partyLevel = Math.max(numField.min, Math.min(numField.max, parseInt(e.target.value) || numField.current));
          });
        }
      }
    } else {
      // Fresh template — sync stored value back into the input on every render
      const input = el.querySelector(".filter-number-field[data-filter-key='partyLevel']");
      if (input && app._partyLevel != null) input.value = app._partyLevel;
    }

    // Patch roll/generate once per instance to use partyLevel
    if (app._pf2ePatched) return;
    app._pf2ePatched = true;

    if (typeof app._rollItem === "function") {
      const _orig = app._rollItem.bind(app);
      app._rollItem = async function () {
        if (app._partyLevel == null) return _orig();
        app._searching = true; app._noResults = false; app._current = null; app._rolled = true;
        app.render(false);
        try {
          const types        = app._types?.length ? app._types : null;
          const excludeNames = new Set((app._items ?? []).map((i) => i.name).filter(Boolean));
          const results      = await adapter.findItems({ partyLevel: app._partyLevel, types, limit: 1, excludeNames });
          app._current  = results[0] ?? null;
          app._noResults = !results.length;
        } catch (err) { console.error("LootRoller |", err); app._noResults = true; }
        finally { app._searching = false; app.render(false); }
      };
    }

    if (typeof app._generate === "function") {
      const _orig = app._generate.bind(app);
      app._generate = async function () {
        if (app._partyLevel == null) return _orig();
        app._generating = true; app._items = [];
        app.render(false);
        try {
          const types = app._types?.length ? app._types : null;
          app._items  = await adapter.findItems({ partyLevel: app._partyLevel, types, limit: app._itemCount ?? 10 });
        } catch (err) { console.error("LootRoller |", err); }
        finally { app._generating = false; app.render(false); }
      };
    }
  };

  Hooks.on("renderQuestGeneratorApp", _inject);
  Hooks.on("renderShopGeneratorApp",  _inject);
}

// ── GM Toolbar button ─────────────────────────────────────────────────────────
//
// DOM injection into the v14 scene-controls-layers menu.
// renderSceneControls fires after the ApplicationV2 SceneControls renders, and
// the MutationObserver re-injects on every subsequent re-render (layer switches
// wipe the inner HTML).
{
  let _observer = null;

  const _inject = () => {
    if (!game.user?.isGM) return;

    const host = document.getElementById("scene-controls")
      ?? document.getElementById("controls");
    if (!host) return;

    if (host.querySelector("[data-loot-roller-btn]")) return;

    const title = game.i18n?.localize("LOOTROLLER.toolbar.openRoller") ?? "Loot Roller";

    // v14 renders the layer list as <menu id="scene-controls-layers">
    const list = host.querySelector("#scene-controls-layers")
      ?? host.querySelector("menu[data-application-part='layers']")
      ?? host.querySelector("menu")
      ?? host.querySelector("ol")
      ?? host.querySelector("ul")
      ?? host;

    // v14 structure: <li><button class="control ui-control icon fa-..."></button></li>
    const li  = document.createElement("li");
    const btn = document.createElement("button");
    btn.type      = "button";
    btn.className = "control ui-control icon fa-solid fa-coins loot-roller-control";
    btn.setAttribute("data-loot-roller-btn", "1");
    btn.setAttribute("data-tooltip", title);
    btn.setAttribute("aria-label", title);
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      LootRoller.openRoller();
    });
    li.appendChild(btn);
    list.appendChild(li);
  };

  Hooks.on("renderSceneControls", () => {
    _inject();
    if (!_observer) {
      const host = document.getElementById("scene-controls")
        ?? document.getElementById("controls");
      if (host) {
        _observer = new MutationObserver(_inject);
        _observer.observe(host, { childList: true, subtree: true });
      }
    }
  });
}
