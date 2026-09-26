/* =============================================================
 * Train Hard — конфигурация Premium и платежей
 *
 * Текущий план: 30 дней Premium через Platega / СБП.
 * Frontend-сборка обновляется автоматически через GitHub Actions.
 *
 * Секреты Platega находятся ТОЛЬКО на backend Render:
 *   PLATEGA_MERCHANT_ID
 *   PLATEGA_SECRET
 * ============================================================= */
(function () {
  'use strict';

  window.TRAINHARD_PREMIUM = {
    priceLabel: '99 ₽',
    periodDays: 30,

    payments: {
      enabled: true,
      provider: 'platega',
      paymentMethod: 2,
      currency: 'RUB',
      amountRub: 99,
      apiBase: 'https://train-hard.onrender.com'
    }
  };
})();
