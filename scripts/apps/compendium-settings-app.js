/**
 * CompendiumSettingsApp — lets the GM choose which Item compendiums are
 * searched by the Quest and Shop generators.
 */

import { LootRoller }   from "../api.js";
import { CompendiumHelper } from "../compendium-helper.js";
import { LootHubApp }   from "./loot-hub-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class CompendiumSettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "loot-roller-compendium-settings",
    classes: ["loot-roller", "compendium-settings"],
    window: { title: "LOOTROLLER.settings.compendiumSources.title", icon: "fa-solid fa-book", resizable: false },
    position: { width: 500, height: "auto" },
  };

  static PARTS = {
    content: { template: "modules/loot-roller/templates/compendium-settings.hbs" },
  };

  async _prepareContext(options) {
    const adapter      = LootRoller.getAdapter();
    const defaultPacks = new Set(adapter?.getCompendiumPacks?.() ?? []);

    let setting = {};
    try { setting = game.settings.get("loot-roller", "compendiumPacks") ?? {}; } catch {}
    const hasCustom = Object.keys(setting).length > 0;

    const packs = game.packs
      .filter((p) => p.documentName === "Item")
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((pack) => ({
        id:        pack.collection,
        title:     pack.title,
        source:    pack.metadata?.packageTitle ?? pack.metadata?.packageName ?? pack.collection.split(".")[0],
        count:     pack.index.size,
        isDefault: defaultPacks.has(pack.collection),
        enabled:   hasCustom ? !!(setting[pack.collection]) : defaultPacks.has(pack.collection),
      }));

    return { packs };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    this.element.querySelector("[data-action=save]")
      ?.addEventListener("click", () => this._save());

    this.element.querySelector("[data-action=reset-defaults]")
      ?.addEventListener("click", () => this._resetDefaults());
  }

  async _save() {
    const setting = {};
    this.element.querySelectorAll("[data-pack-id]").forEach((cb) => {
      setting[cb.dataset.packId] = cb.checked;
    });
    await game.settings.set("loot-roller", "compendiumPacks", setting);
    CompendiumHelper.clearPool();
    LootRoller.getAdapter()?.clearPool?.();
    LootHubApp._poolWarmed = false;
    ui.notifications.info(game.i18n.localize("LOOTROLLER.settings.compendiumSources.saved"));
    this.close();
  }

  async _resetDefaults() {
    await game.settings.set("loot-roller", "compendiumPacks", {});
    CompendiumHelper.clearPool();
    LootRoller.getAdapter()?.clearPool?.();
    LootHubApp._poolWarmed = false;
    this.render(false);
  }
}
