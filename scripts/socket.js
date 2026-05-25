/**
 * Socket layer for Loot Roller.
 *
 * All messages flow through the single "module.loot-roller" channel.
 * Schema: { type: MSG, payload: object, senderId: string }
 *
 * Direction key:
 *   GM → All   : broadcast to every connected client
 *   Player → GM: routed to the GM's client (the GM aggregates responses)
 */

export const MSG = Object.freeze({
  /** GM → All: an item is now open for lottery rolling. */
  ITEM_UP_FOR_ROLL: "itemUpForRoll",
  /** GM → subset: tie-breaker — only tied players re-roll. */
  TIE_BREAKER: "tieBreaker",
  /** Player → GM: the player rolled this value. */
  PLAYER_ROLL: "playerRoll",
  /** Player → GM: the player is passing on this item. */
  PLAYER_PASS: "playerPass",
  /** GM → All: this item was awarded to a winner. */
  ITEM_RESOLVED: "itemResolved",
  /** GM → All: all lottery items have been processed. */
  LOTTERY_COMPLETE: "lotteryComplete",
});

const CHANNEL = "module.loot-roller";

/**
 * Emit a socket message.
 * @param {string} type  One of MSG.*
 * @param {object} payload
 */
export function emit(type, payload = {}) {
  game.socket.emit(CHANNEL, { type, payload, senderId: game.user.id });
}

/**
 * Register the socket listener. Called once from main.js init hook.
 * Routes incoming messages to the appropriate handler based on GM/player role.
 */
export function registerSocketHandlers() {
  game.socket.on(CHANNEL, (data) => {
    const { type, payload, senderId } = data;

    if (game.user.isGM) {
      _handleGMMessage(type, payload, senderId);
    } else {
      _handlePlayerMessage(type, payload, senderId);
    }
  });
}

function _handleGMMessage(type, payload, senderId) {
  const manager = game.modules.get("loot-roller").lotteryManager;
  if (!manager) return;

  switch (type) {
    case MSG.PLAYER_ROLL:
      manager.recordResponse(senderId, { roll: payload.roll });
      break;
    case MSG.PLAYER_PASS:
      manager.recordResponse(senderId, { pass: true });
      break;
  }
}

function _handlePlayerMessage(type, payload, senderId) {
  const { LotteryPlayerApp } = game.modules.get("loot-roller").apps;

  switch (type) {
    case MSG.ITEM_UP_FOR_ROLL:
      LotteryPlayerApp.openForItem(payload);
      break;
    case MSG.TIE_BREAKER:
      LotteryPlayerApp.openForTieBreaker(payload);
      break;
    case MSG.ITEM_RESOLVED:
      LotteryPlayerApp.closeAndAnnounce(payload);
      break;
    case MSG.LOTTERY_COMPLETE:
      LotteryPlayerApp.closeAll();
      break;
  }
}
