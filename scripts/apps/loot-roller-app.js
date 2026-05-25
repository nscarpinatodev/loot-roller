/**
 * LootRollerApp — GM-facing main loot generation dialog.
 *
 * Renders a dynamic form whose fields come from the active system adapter.
 * On submit, calls adapter.generateLoot() and opens LotterySetupApp.
 */

import { LootRoller } from "../api.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootRollerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "loot-roller-app",
    classes: ["loot-roller", "loot-roller-generate"],
    tag: "form",
    form: { handler: LootRollerApp.#onSubmit, submitOnChange: false, closeOnSubmit: false },
    window: { title: "LOOTROLLER.app.title", icon: "fa-solid fa-coins", resizable: false },
    position: { width: 440, height: "auto" },
  };

  static PARTS = {
    form: { template: "modules/loot-roller/templates/loot-roller.hbs" },
  };

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

    // Show a spinner on the submit button
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

    const { LotterySetupApp } = game.modules.get("loot-roller").apps;
    new LotterySetupApp(lootResult).render(true);
  }
}
