/**
 * LootRollerApp — GM-facing main loot generation dialog.
 *
 * Renders a dynamic form whose fields come from the active system adapter.
 * On submit, calls adapter.generateLoot() and accumulates results into a
 * running list. The GM can roll multiple times, remove unwanted items, then
 * proceed to the lottery setup.
 */

import { LootRoller } from "../api.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootRollerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "loot-roller-app",
    classes: ["loot-roller", "loot-roller-generate"],
    tag: "form",
    form: { handler: LootRollerApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    window: { title: "LOOTROLLER.app.title", icon: "fa-solid fa-coins", resizable: true },
    position: { width: 440, height: "auto" },
  };

  static PARTS = {
    form: { template: "modules/loot-roller/templates/loot-roller.hbs" },
  };

  constructor(options = {}) {
    super(options);
    /** @type {Array<Item>} Accumulated resolved items across all rolls. */
    this._items = [];
    /** @type {Record<string, number>} Running coin totals across all rolls. */
    this._coins = {};
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const updateVisibility = () => {
      this.element.querySelectorAll("[data-show-when-field]").forEach((el) => {
        const controller = this.element.querySelector(`[name="${el.dataset.showWhenField}"]`);
        if (!controller) return;
        el.style.display = controller.value === el.dataset.showWhenValue ? "" : "none";
      });
    };

    this.element.addEventListener("change", updateVisibility);
    updateVisibility();

    // Restore results section after any re-render (e.g. window resize)
    this._updateResultsDOM();

    this.element.querySelector("[data-action=clear-results]")?.addEventListener("click", () => {
      this._items = [];
      this._coins = {};
      this._updateResultsDOM();
    });

    this.element.querySelector("[data-action=proceed-to-lottery]")?.addEventListener("click", () => {
      if (!this._items.length) return;
      const { LotterySetupApp } = game.modules.get("loot-roller").apps;
      new LotterySetupApp({ coins: this._coins, items: this._items }).render(true);
      this.close();
    });
  }

  /**
   * Sync the results section DOM with this._items and this._coins.
   * Called after every generation roll and after any item removal.
   */
  _updateResultsDOM() {
    const section = this.element?.querySelector(".loot-results-section");
    if (!section) return;

    const hasItems = this._items.length > 0;
    const hasCoins = Object.values(this._coins).some(v => v > 0);
    section.style.display = (hasItems || hasCoins) ? "" : "none";

    // Update submit button label to reflect whether this is the first or a subsequent roll
    const submitBtn = this.element.querySelector("[type=submit]");
    if (submitBtn) {
      if (hasItems || hasCoins) {
        submitBtn.innerHTML = `<i class="fa-solid fa-rotate"></i> ${game.i18n.localize("LOOTROLLER.app.rollAgainButton")}`;
      } else {
        submitBtn.innerHTML = `<i class="fa-solid fa-coins"></i> ${game.i18n.localize("LOOTROLLER.app.generateButton")}`;
      }
    }

    // Coins
    const coinsEl = section.querySelector(".loot-result-coins");
    if (coinsEl) {
      coinsEl.innerHTML = "";
      for (const [key, val] of Object.entries(this._coins)) {
        if (!val) continue;
        const chip = document.createElement("span");
        chip.className = "loot-coin-chip";
        chip.innerHTML = `<i class="fa-solid fa-coins"></i> ${val} ${key.toUpperCase()}`;
        coinsEl.appendChild(chip);
      }
      coinsEl.style.display = hasCoins ? "" : "none";
    }

    // Items list — rebuilt from scratch on each call so indices stay correct
    const listEl = section.querySelector(".loot-result-items");
    if (!listEl) return;
    listEl.innerHTML = "";
    this._items.forEach((item, idx) => {
      const li = document.createElement("li");
      li.className = "lottery-item";
      li.innerHTML = `
        <img class="item-img" src="${item.img ?? "icons/svg/item-bag.svg"}" alt="">
        <div class="item-info">
          <span class="item-name">${item.name ?? "Unknown Item"}</span>
        </div>
        <button type="button" class="btn-icon-remove" title="${game.i18n.localize("LOOTROLLER.quest.removeItem")}">
          <i class="fa-solid fa-xmark"></i>
        </button>`;
      li.querySelector(".btn-icon-remove").addEventListener("click", () => {
        this._items.splice(idx, 1);
        this._updateResultsDOM();
      });
      listEl.appendChild(li);
    });
  }

  /** @returns {object} Data passed to the Handlebars template. */
  async _prepareContext(options) {
    const adapter = LootRoller.getAdapter();
    return {
      systemName: adapter?.systemName ?? game.system.title,
      fields: adapter?.getGeneratorFields() ?? [],
      hasAdapter: !!adapter,
    };
  }

  static async #onSubmit(event, form, formData) {
    const adapter = LootRoller.getAdapter();
    if (!adapter) return;

    const params = formData.object;

    const btn = form.querySelector("[type=submit]");
    btn.disabled = true;

    let lootResult;
    try {
      lootResult = await adapter.generateLoot(params);
      lootResult.items = await adapter.resolveItems(lootResult.items);
    } catch (err) {
      console.error("LootRoller | generateLoot failed:", err);
      ui.notifications.error("LOOTROLLER.error.generateFailed", { localize: true });
      btn.disabled = false;
      return;
    }

    btn.disabled = false;

    // Accumulate into the running list
    this._items.push(...(lootResult.items ?? []));
    for (const [key, val] of Object.entries(lootResult.coins ?? {})) {
      if (val > 0) this._coins[key] = (this._coins[key] ?? 0) + val;
    }

    this._updateResultsDOM();
  }
}
