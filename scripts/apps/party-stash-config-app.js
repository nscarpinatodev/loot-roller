/**
 * PartyStashConfigApp — registered as a module settings menu entry.
 *
 * Opened via Configure Settings → Loot Roller → Configure Party Stash.
 * Provides a drag-drop zone to assign an actor as the party stash target.
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class PartyStashConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "party-stash-config",
    classes: ["loot-roller"],
    window: {
      title: "LOOTROLLER.settings.partyStashConfig.name",
      icon: "fa-solid fa-box",
    },
    position: { width: 360, height: "auto" },
  };

  static PARTS = {
    content: { template: "modules/loot-roller/templates/party-stash-config.hbs" },
  };

  async _prepareContext(options) {
    const uuid = game.settings.get("loot-roller", "partyStashActor");
    const actor = uuid ? await fromUuid(uuid) : null;
    return {
      stashActorName: actor?.name ?? null,
      stashActorImg: actor?.img ?? null,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);

    const dropTarget = this.element.querySelector(".party-stash-drop");
    if (dropTarget) {
      dropTarget.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropTarget.classList.add("drag-over");
      });
      dropTarget.addEventListener("dragleave", () => dropTarget.classList.remove("drag-over"));
      dropTarget.addEventListener("drop", async (e) => {
        e.preventDefault();
        dropTarget.classList.remove("drag-over");
        const data = TextEditor.getDragEventData(e);
        if (data.type !== "Actor") return;
        const actor = await fromUuid(data.uuid);
        if (!actor) return;
        await game.settings.set("loot-roller", "partyStashActor", data.uuid);
        this.render(false);
      });
    }

    this.element.querySelector("[data-action=clear-stash]")?.addEventListener("click", async (e) => {
      e.preventDefault();
      await game.settings.set("loot-roller", "partyStashActor", "");
      this.render(false);
    });
  }
}
