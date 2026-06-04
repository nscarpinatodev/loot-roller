/**
 * SavedListsApp — browse and award previously saved loot lists.
 *
 * Lists are stored via LootListManager and grouped by category
 * (quest, shop, custom). The GM can award a list (opens Lottery Setup),
 * rename it, or delete it.
 */

import { LootListManager } from "../loot-list-manager.js";
import { LotterySetupApp } from "./lottery-setup-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SavedListsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "saved-lists-app",
    classes: ["loot-roller", "saved-lists"],
    window: { title: "LOOTROLLER.savedLists.title", icon: "fa-solid fa-list", resizable: true },
    position: { width: 520, height: 480 },
  };

  static PARTS = {
    content: { template: "modules/scorpious187s-loot-roller/templates/saved-lists.hbs" },
  };

  async _prepareContext(options) {
    const all   = LootListManager.getAll();
    const lists = Object.values(all).sort((a, b) => b.createdAt - a.createdAt);

    return {
      lists: lists.map((list) => ({
        ...list,
        itemCount:   (list.items ?? []).length,
        createdDate: new Date(list.createdAt).toLocaleDateString(),
        categoryLabel: `LOOTROLLER.savedLists.category.${list.category ?? "custom"}`,
      })),
      isEmpty: !lists.length,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    this.element.querySelectorAll("[data-action=award-list]").forEach((btn) => {
      btn.addEventListener("click", () => this._awardList(btn.dataset.id));
    });

    this.element.querySelectorAll("[data-action=rename-list]").forEach((btn) => {
      btn.addEventListener("click", () => this._renameList(btn.dataset.id));
    });

    this.element.querySelectorAll("[data-action=delete-list]").forEach((btn) => {
      btn.addEventListener("click", () => this._deleteList(btn.dataset.id));
    });
  }

  async _awardList(id) {
    const list = LootListManager.get(id);
    if (!list) return;
    this.close();
    new LotterySetupApp({ coins: list.coins ?? {}, items: list.items ?? [] }).render(true);
  }

  async _renameList(id) {
    const list = LootListManager.get(id);
    if (!list) return;

    const escaped = list.name.replace(/"/g, "&quot;");
    const name = await Dialog.prompt({
      title: game.i18n.localize("LOOTROLLER.savedLists.renamePrompt"),
      content: `<div class="form-group">
        <label>${game.i18n.localize("LOOTROLLER.savedLists.nameLabel")}</label>
        <input type="text" name="listName" value="${escaped}" autofocus />
      </div>`,
      label: game.i18n.localize("LOOTROLLER.savedLists.rename"),
      callback: (html) => html.find("[name=listName]").val().trim(),
      options: { width: 320 },
    }).catch(() => null);

    if (!name || name === list.name) return;
    await LootListManager.rename(id, name);
    this.render(false);
  }

  async _deleteList(id) {
    const list = LootListManager.get(id);
    if (!list) return;

    const confirmed = await Dialog.confirm({
      title: game.i18n.localize("LOOTROLLER.savedLists.deleteConfirmTitle"),
      content: game.i18n.format("LOOTROLLER.savedLists.deleteConfirmBody", { name: list.name }),
    });

    if (!confirmed) return;
    await LootListManager.delete(id);
    this.render(false);
  }
}
