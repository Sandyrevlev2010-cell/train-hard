/* =============================================================
 * Train Hard — ARENA API client
 *
 * Identity:
 *   Telegram.WebApp.initData
 *
 * Session:
 *   short-lived Bearer token cached in localStorage
 *
 * IMPORTANT:
 *   This client normalizes Arena/backend routes to /api.
 * ============================================================= */

(function () {
  'use strict';

  var cfg = window.TRAINHARD_ARENA || {};

  var base = String(
    cfg.apiBase ||
    'https://train-hard.onrender.com'
  ).replace(/\/+$/, '');

  var TOKEN_KEY = 'trainhard_api_session';

  var token = null;
  var user = null;

  function tg() {
    try {
      return window.Telegram &&
        window.Telegram.WebApp
        ? window.Telegram.WebApp
        : null;
    } catch (e) {
      return null;
    }
  }

  function initData() {
    var app = tg();

    if (
      app &&
      typeof app.initData === 'string' &&
      app.initData
    ) {
      return app.initData;
    }

    return '';
  }

  function startParam() {
    var app = tg();

    try {
      if (
        app &&
        app.initDataUnsafe &&
        typeof app.initDataUnsafe.start_param === 'string'
      ) {
        return app.initDataUnsafe.start_param;
      }
    } catch (e) {}

    return '';
  }

  function loadCached() {
    try {
      var raw =
        window.localStorage.getItem(TOKEN_KEY);

      if (!raw) return;

      var data = JSON.parse(raw);

      if (
        data &&
        typeof data.token === 'string' &&
        data.token &&
        Number(data.expires_at || 0) > Date.now()
      ) {
        token = data.token;
        user = data.user || null;
      }
    } catch (e) {
      token = null;
      user = null;
    }
  }

  function saveCached() {
    try {
      window.localStorage.setItem(
        TOKEN_KEY,
        JSON.stringify({
          token: token,
          user: user,
          expires_at:
            Date.now() + 25 * 86400000
        })
      );
    } catch (e) {}
  }

  function clearCached() {
    token = null;
    user = null;

    try {
      window.localStorage.removeItem(
        TOKEN_KEY
      );
    } catch (e) {}
  }

  loadCached();

  function rawFetch(url, options) {
    if (
      typeof window.fetch === 'function'
    ) {
      return window.fetch(url, options);
    }

    return Promise.reject(
      new Error('fetch is unavailable')
    );
  }

  async function authenticate() {
    var data = initData();

    if (!data) {
      return {
        ok: false,
        reason: 'telegram-required'
      };
    }

    var response;

    try {
      response = await rawFetch(
        base + '/api/auth/telegram',
        {
          method: 'POST',
          headers: {
            'Content-Type':
              'application/json'
          },
          body: JSON.stringify({
            initData: data
          })
        }
      );
    } catch (error) {
      return {
        ok: false,
        reason: 'network'
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        reason:
          'auth-' + response.status,
        status: response.status
      };
    }

    var json;

    try {
      json = await response.json();
    } catch (error) {
      return {
        ok: false,
        reason: 'bad-json'
      };
    }

    if (
      !json ||
      typeof json.token !== 'string' ||
      !json.token
    ) {
      return {
        ok: false,
        reason: 'invalid-auth-response'
      };
    }

    token = json.token;
    user = json.user || null;

    saveCached();

    return {
      ok: true,
      user: user
    };
  }

  async function request(
    method,
    path,
    body
  ) {
    var normalizedPath =
      String(path || '');

    if (
      !normalizedPath.startsWith('/')
    ) {
      normalizedPath =
        '/' + normalizedPath;
    }

    var apiPath =
      normalizedPath === '/api' ||
      normalizedPath.indexOf('/api/') === 0
        ? normalizedPath
        : '/api' + normalizedPath;

    if (!token) {
      var auth =
        await authenticate();

      if (!auth.ok) {
        return {
          ok: false,
          status: 0,
          reason: auth.reason,
          body: null
        };
      }
    }

    async function doRequest() {
      var headers = {
        'Authorization':
          'Bearer ' + token
      };

      if (body !== undefined) {
        headers['Content-Type'] =
          'application/json';
      }

      return rawFetch(
        base + apiPath,
        {
          method: method,
          headers: headers,
          body:
            body !== undefined
              ? JSON.stringify(body)
              : undefined
        }
      );
    }

    var response;

    try {
      response =
        await doRequest();
    } catch (error) {
      return {
        ok: false,
        status: 0,
        reason: 'network',
        body: null
      };
    }

    if (response.status === 401) {
      clearCached();

      var reauth =
        await authenticate();

      if (!reauth.ok) {
        return {
          ok: false,
          status: 401,
          reason: reauth.reason,
          body: null
        };
      }

      try {
        response =
          await doRequest();
      } catch (error) {
        return {
          ok: false,
          status: 0,
          reason: 'network',
          body: null
        };
      }
    }

    var json = null;

    try {
      json = await response.json();
    } catch (e) {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      body: json
    };
  }

  window.__THAPI = {
    available: function () {
      return !!initData();
    },
    authenticate: authenticate,
    request: request,
    startParam: startParam,
    user: function () {
      return user;
    },
    token: function () {
      return token;
    },
    _resetForTests: function () {
      clearCached();
    }
  };

  setTimeout(
    function () {
      try {
        if (
          !token &&
          initData()
        ) {
          authenticate()
            .catch(function () {});
        }
      } catch (e) {}
    },
    0
  );
})();
