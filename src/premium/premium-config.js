/* =============================================================
 * Train Hard — конфигурация Premium и платежей
 *
 * ЕДИНСТВЕННОЕ место настроек monetization.
 *
 * Текущий план: 1 TON / 30 дней Premium (разовый платёж, без автосписаний).
 *
 * БЕЗОПАСНОСТЬ:
 * • tonAddress — ПУБЛИЧНЫЙ адрес кошелька получателя (не секрет).
 *   Секретных ключей кошелька во frontend НЕТ и быть не должно.
 * • Подтверждение оплаты — транзакция в открытом блокчейне TON
 *   (публичный API toncenter), а не утверждение клиента.
 *
 * Как поменять план: tonAmount (цена в TON) и periodDays (дней) ниже;
 * priceLabel — строка для UI. Никаких других мест править не нужно.
 * ============================================================= */
(function () {
  'use strict';

  window.TRAINHARD_PREMIUM = {
    /* План подписки */
    priceLabel: '1 TON',
    periodDays: 30,

    payments: {
      enabled: true,
      provider: 'ton',

      /* Кошелёк проекта (TON, mainnet) — публичный адрес получателя */
      tonAddress: 'UQCFlpQJExAvzamuoBazfMw67wBzGXBEWkci0DLQxYw5Yi8a',
      tonAmount: 1,                  /* TON за periodDays дней */

      /* Зарезервировано на будущее (web-backend с серверной проверкой):
         непустой https verifyUrl переключит проверку на сервер — см.
         docs/PREMIUM-PAYMENTS.md. Сейчас проверка идёт через toncenter. */
      verifyUrl: ''
    }
  };
})();
