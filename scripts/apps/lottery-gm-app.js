/**
 * LotteryGMApp — GM monitor during an active item lottery.
 *
 * Opens when the lottery starts. Shows the current item, each player's
 * response status, and a Force Resolve button. Refreshed by LotteryManager
 * whenever state changes.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LotteryGMApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "lottery-gm-app",
    classes: ["loot-roller", "lottery-gm"],
    window: {
      title: "LOOTROLLER.lottery.gmMonitorTitle",
      icon: "fa-solid fa-dice-d20",
    },
    position: { width: 400, height: "auto", top: 80, left: 120 },
  };

  static PARTS = {
    content: { template: "modules/scorpious187s-loot-roller/templates/lottery-gm.hbs" },
  };

  constructor(manager, options = {}) {
    super(options);
    this._manager = manager;
  }

  async _prepareContext(options) {
    return this._manager.getGMState();
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.querySelector("[data-action=force-resolve]")?.addEventListener("click", () => {
      this._manager.forceResolve();
    });
  }

  /** Called by LotteryManager whenever state changes. */
  refresh() {
    this.render(false);
  }
}
