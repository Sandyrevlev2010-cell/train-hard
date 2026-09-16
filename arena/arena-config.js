/* =============================================================
 * Train Hard — ARENA configuration
 *
 * Invitation links use Telegram Mini App startapp. Opening a generated
 * link inside Telegram passes the invite token as start_param; Arena
 * consumes it server-side and the user is joined automatically.
 * ============================================================= */
(function () {
  'use strict';
  window.TRAINHARD_ARENA = Object.assign({
    apiBase: 'https://train-hard.onrender.com',
    botAppLink: 'https://t.me/trainhard_power_bot/trainhard?startapp=',
    inviteTtlNote: 'ссылка одноразовая и действует 24 часа'
  }, window.TRAINHARD_ARENA || {});
})();
