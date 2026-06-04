/**
 * ItemDetailApp — a lightweight popup that shows an item's details using the
 * module's own detail renderer (image, type, system-aware stats, enriched
 * description) instead of opening the raw Foundry item sheet.
 *
 * Open via: new ItemDetailApp({ item, mystified }).render(true)
 * `item` may be a live Item document or a plain item-data object.
 */

import { buildItemDetail } from "../item-detail.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ItemDetailApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "loot-roller-item-detail",
    classes: ["loot-roller", "item-detail-window"],
    window: { title: "LOOTROLLER.detail.title", icon: "fa-solid fa-circle-info", resizable: true },
    position: { width: 420, height: "auto" },
  };

  static PARTS = {
    content: { template: "modules/scorpious187s-loot-roller/templates/item-detail.hbs" },
  };

  constructor({ item, mystified, title, ...options } = {}) {
    super(options);
    this._item = item;
    this._mystified = mystified;
    this._titleOverride = title ?? item?.name ?? null;
  }

  get title() {
    return this._titleOverride ?? game.i18n.localize("LOOTROLLER.detail.title");
  }

  async _prepareContext() {
    return buildItemDetail(this._item, { mystified: this._mystified });
  }

  /**
   * Convenience: resolve an item from a UUID or plain data, then open the popup.
   * @param {{ uuid?: string, item?: Item|object, mystified?: boolean }} opts
   */
  static async show({ uuid, item, mystified } = {}) {
    let resolved = item ?? null;
    if (!resolved && uuid) resolved = await fromUuid(uuid).catch(() => null);
    if (!resolved) return null;
    const app = new ItemDetailApp({ item: resolved, mystified });
    app.render(true);
    return app;
  }
}
