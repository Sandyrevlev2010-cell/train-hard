/* =============================================================
 * Train Hard — конфигурация Premium и платежей
 *
 * Текущий план: 30 дней Premium через Platega / СБП.
 *
 * Секреты Platega находятся ТОЛЬКО на backend Render:
 *   PLATEGA_MERCHANT_ID
 *   PLATEGA_SECRET
 * ============================================================= */
(function () {
  'use strict';

  window.TRAINHARD_PREMIUM = {
    priceLabel: 'СБП',
    periodDays: 30,

    payments: {
      enabled: true,
      provider: 'platega',
      paymentMethod: 2,
      currency: 'RUB',
      apiBase: 'https://train-hard.onrender.com'
    }
  };
})();
