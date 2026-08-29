/* =============================================================
 * Train Hard MVP — StorageService
 * Единая точка доступа к локальному хранилищу.
 *
 * Сейчас:      localStorage (с memory-фолбэком)
 * Будущее:     API → PostgreSQL (добавить sync() и включить backend.enabled)
 *
 * БЕЗОПАСНОСТЬ (см. docs/SECURITY-AUDIT.md):
 * • localStorage НЕ является безопасным хранилищем и НЕ считается
 *   им: секреты (пароли, ключи, платёжные данные) здесь не хранятся.
 * • Любые прочитанные данные считаются недоверенными: JSON.parse
 *   защищён try/catch, поддержана валидация схемы (getValidated),
 *   аномально большие значения отбрасываются.
 * • Фолбэк-режим (memory) не ломает приложение в sandbox/приватных
 *   окнах — данные просто живут до перезагрузки страницы.
 * ============================================================= */
(function () {
  'use strict';

  var PREFIX = 'trainhard_';
  var MAX_VALUE_BYTES = 262144;   // 256 КБ: всё, что больше, — повреждённое/чужое значение
  var memory = Object.create(null);
  var probed = null;

  function safe(fn, fallback) {
    try { return fn(); } catch (e) { return fallback; }
  }

  /** Проверяем доступность localStorage один раз (sandbox/приватный режим). */
  function available() {
    if (probed !== null) return probed;
    probed = safe(function () {
      var k = '__th_probe__';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      return true;
    }, false);
    return probed;
  }

  var StorageService = {
    /** true — физическое хранилище доступно (иначе режим «только в памяти»). */
    available: available,

    /** Читает JSON-значение; при отсутствии/повреждении/переборе размера — fallback. */
    get: function (key, fallback) {
      if (fallback === undefined) fallback = null;
      if (!available()) {
        return key in memory ? memory[key] : fallback;
      }
      return safe(function () {
        var raw = window.localStorage.getItem(key);
        if (raw == null) return fallback;
        if (raw.length > MAX_VALUE_BYTES) return fallback;      // huge value → не доверяем
        try { return JSON.parse(raw); } catch (e) { return fallback; } // повреждённые данные не роняют приложение
      }, fallback);
    },

    /** Читает JSON и прогоняет через валидатор схемы.
     *  validator(value) → очищенное значение или null (тогда fallback).
     *  Используется для premium/настроек/статистики: неожиданные типы
     *  и структуры не проходят дальше в приложение. */
    getValidated: function (key, validator, fallback) {
      var v = this.get(key, null);
      if (typeof validator !== 'function') return fallback;
      var out = safe(function () { return validator(v); }, null);
      return (out === null || out === undefined) ? fallback : out;
    },

    /** Пишет JSON. Слишком большие значения не пишутся (true → успех). */
    set: function (key, value) {
      var raw = safe(function () { return JSON.stringify(value); }, null);
      if (raw === null || raw.length > MAX_VALUE_BYTES) return false;
      memory[key] = value;
      if (!available()) return false;
      return safe(function () { window.localStorage.setItem(key, raw); return true; }, false);
    },

    remove: function (key) {
      delete memory[key];
      if (!available()) return false;
      return safe(function () { window.localStorage.removeItem(key); return true; }, false);
    },

    /** Список ключей приложения (для экспорта/диагностики). */
    keys: function () {
      if (!available()) return Object.keys(memory).filter(function (k) { return k.indexOf(PREFIX) === 0; });
      return safe(function () {
        return Object.keys(window.localStorage).filter(function (k) { return k.indexOf(PREFIX) === 0; });
      }, []);
    },

    /** Будущий API-слой. Пока выключен — MVP полностью офлайн.
     *  NOTE (CSRF): при включении cookie-based auth сюда же добавляется
     *  CSRF-токен для state-changing запросов. */
    backend: { enabled: false, baseUrl: '', sync: function () { /* future */ } }
  };

  window.TrainHardStorage = StorageService;
})();
