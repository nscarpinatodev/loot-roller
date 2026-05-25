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

// System adapters — only one will self-register based on game.system.id
import "./systems/dnd5e-adapter.js";
import "./systems/pf2e-adapter.js";

const MODULE_ID = "loot-roller";

// ── init ─────────────────────────────────────────────────────────────────────

Hooks.once("init", () => {
  // ── Global settings ──────────────────────────────────────────────────────
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
    (rarity ?? "").toLowerCase().replace(/\s+/g, "-")
  );
});

// ── ready ─────────────────────────────────────────────────────────────────────

Hooks.once("ready", () => {
  // ── Expose global API ────────────────────────────────────────────────────
  window.LootRoller = LootRoller;

  // ── Store app constructors on module for cross-file access ───────────────
  const mod = game.modules.get(MODULE_ID);
  mod.apps = { LootHubApp, LootRollerApp, LotterySetupApp, LotteryPlayerApp, LotteryGMApp, QuestGeneratorApp, ShopGeneratorApp, SavedListsApp };
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

  // ── Pre-warm compendium indexes ──────────────────────────────────────────
  if (adapter?.getCompendiumPacks) {
    for (const packId of adapter.getCompendiumPacks()) {
      CompendiumHelper.getIndex(packId).catch(() => {}); // fire-and-forget
    }
  }

  console.log(`Loot Roller | Ready. Adapter: ${adapter?.systemName ?? "none"}`);
});

// ── GM Toolbar button ─────────────────────────────────────────────────────────

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user?.isGM) return;

  const title = game.i18n?.localize("LOOTROLLER.toolbar.openRoller") ?? "Loot Roller";

  const tool = {
    name: "loot-roller",
    title,
    icon: "fa-solid fa-coins",
    visible: true,
    button: true,
    onClick: () => LootRoller.openRoller(),
  };

  if (Array.isArray(controls)) {
    // Foundry v12: controls is an array of group objects
    const token = controls.find((g) => g.name === "token");
    if (!token) return;
    if (Array.isArray(token.tools)) {
      token.tools.push(tool);
    } else {
      token.tools ??= {};
      token.tools["loot-roller"] = tool;
    }
  } else {
    // Foundry v13+: controls is a plain object keyed by group name.
    // Use direct property access — going through Object.values() returns
    // references that may not survive Foundry's controls rebuild step.
    if (!controls.token) return;
    if (Array.isArray(controls.token.tools)) {
      controls.token.tools.push(tool);
    } else {
      controls.token.tools ??= {};
      controls.token.tools["loot-roller"] = tool;
    }
  }
});

// Fallback: DOM injection via MutationObserver.
//
// ApplicationV2-based apps (Foundry v13 SceneControls) fully replace their
// inner HTML on every re-render, so a one-shot renderSceneControls injection
// gets wiped on the next layer switch. We instead observe the #scene-controls
// container for childList changes and re-inject whenever Foundry replaces the
// inner content.
//
// We only start observing once the canvas is ready (controls exist in DOM).
Hooks.once("canvasReady", () => {
  if (!game.user?.isGM) return;

  const injectBtn = () => {
    const sceneControls = document.getElementById("scene-controls");
    if (!sceneControls) return;

    // Already injected — nothing to do.
    if (sceneControls.querySelector("[data-loot-roller-btn]")) return;

    // If getSceneControlButtons worked, the tool renders as [data-tool="loot-roller"].
    if (sceneControls.querySelector('[data-tool="loot-roller"]')) return;

    const title    = game.i18n?.localize("LOOTROLLER.toolbar.openRoller") ?? "Loot Roller";
    const mainList = sceneControls.querySelector("ol.main-controls");
    if (!mainList) return;

    const btn = document.createElement("li");
    btn.className = "scene-control loot-roller-control";
    btn.setAttribute("data-loot-roller-btn", "1");
    btn.setAttribute("data-tooltip", title);
    btn.setAttribute("aria-label", title);
    btn.innerHTML   = `<i class="fa-solid fa-coins"></i>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      LootRoller.openRoller();
    });
    mainList.appendChild(btn);
  };

  injectBtn(); // Initial injection after canvas ready

  // Re-inject after Foundry re-renders the controls (layer switches, etc.).
  // Watch only direct children of #scene-controls so our own li append
  // (which goes into ol.main-controls, not #scene-controls itself) doesn't
  // trigger a loop.
  const container = document.getElementById("scene-controls");
  if (container) {
    new MutationObserver(injectBtn).observe(container, { childList: true });
  }
});
