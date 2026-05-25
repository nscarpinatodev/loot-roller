/**
 * LootHubApp — main entry point for the Loot Roller toolbar button.
 *
 * Presents four generation modes. Each opens its own dedicated app.
 */

import { LootRoller }          from "../api.js";
import { LootRollerApp }       from "./loot-roller-app.js";
import { QuestGeneratorApp }   from "./quest-generator-app.js";
import { ShopGeneratorApp }    from "./shop-generator-app.js";
import { SavedListsApp }       from "./saved-lists-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootHubApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "loot-hub-app",
    classes: ["loot-roller", "loot-hub"],
    window: { title: "LOOTROLLER.hub.title", icon: "fa-solid fa-coins", resizable: false },
    position: { width: 400, height: "auto" },
  };

  static PARTS = {
    content: { template: "modules/loot-roller/templates/loot-hub.hbs" },
  };

  async _prepareContext(options) {
    const adapter = LootRoller.getAdapter();
    return {
      systemName: adapter?.systemName ?? game.system.title,
      hasAdapter: !!adapter,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const open = (App) => new App().render(true);

    this.element.querySelector("[data-action=open-treasure]")
      ?.addEventListener("click", () => open(LootRollerApp));

    this.element.querySelector("[data-action=open-quest]")
      ?.addEventListener("click", () => open(QuestGeneratorApp));

    this.element.querySelector("[data-action=open-shop]")
      ?.addEventListener("click", () => open(ShopGeneratorApp));

    this.element.querySelector("[data-action=open-lists]")
      ?.addEventListener("click", () => open(SavedListsApp));
  }
}
