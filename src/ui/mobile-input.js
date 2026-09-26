/* =============================================================
 * Train Hard — mobile input UX
 *
 * Finish text entry from the virtual keyboard without losing the value.
 * Some iOS/Telegram WebViews do not reliably expose the keyboard action
 * as a keydown event, so handle both Enter and form submission.
 * ============================================================= */
(function () {
  'use strict';

  function isTextInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var type = String(el.type || 'text').toLowerCase();
    return ['text', 'number', 'search', 'tel', 'email', 'url', 'password'].indexOf(type) !== -1;
  }

  function finishInput(input) {
    if (!isTextInput(input)) return;
    // Do not clear/change the value: blur only releases focus and hides the keyboard.
    input.blur();
  }

  function setupInput(input) {
    if (!isTextInput(input) || input.dataset.thMobileInputReady === '1') return;
    input.dataset.thMobileInputReady = '1';
    input.setAttribute('enterkeyhint', 'done');

    // keydown works for hardware keyboards and WebViews that expose Return.
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.keyCode === 13) {
        if (event.isComposing) return;
        finishInput(input);
      }
    });

    // iOS/Android virtual keyboards can trigger an implicit form submit
    // instead of exposing a keydown event.
    var form = input.form;
    if (form) {
      form.addEventListener('submit', function () {
        window.setTimeout(function () { finishInput(input); }, 0);
      });
    }
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    var inputs = root.querySelectorAll('input');
    for (var i = 0; i < inputs.length; i++) setupInput(inputs[i]);
    if (root.tagName === 'INPUT') setupInput(root);
  }

  scan(document);

  document.addEventListener('focusin', function (event) {
    setupInput(event.target);
  });

  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      for (var j = 0; j < mutations[i].addedNodes.length; j++) {
        scan(mutations[i].addedNodes[j]);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
