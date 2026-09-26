/* =============================================================
 * Train Hard — mobile input UX
 *
 * On mobile keyboards the action/arrow key should finish the current
 * field instead of forcing the user to tap outside the input.
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
    input.blur();
  }

  document.addEventListener('focusin', function (event) {
    var input = event.target;
    if (!isTextInput(input)) return;
    // Tell iOS/Android that the keyboard action completes this field.
    input.enterKeyHint = 'done';
  });

  document.addEventListener('keydown', function (event) {
    var input = event.target;
    if (!isTextInput(input)) return;
    if (event.key !== 'Enter') return;
    if (event.isComposing) return;

    // Keep the typed value in the input, but close the virtual keyboard.
    event.preventDefault();
    finishInput(input);
  });
})();
