// Forum Grading Helper — settings bridge (isolated world, document_start).
// The popup stores settings in chrome.storage.local, which page-world scripts
// cannot read; mirror them onto <html data-fgh-…> so every script (either
// world) reads them synchronously and reacts to changes.
(function (root) {
  'use strict';

  const DEFAULTS = { showProgress: true };
  const doc = root.document;
  const storage = root.chrome && root.chrome.storage && root.chrome.storage.local;
  if (!storage) return;

  function apply(values) {
    if ('showProgress' in values) doc.documentElement.dataset.fghShowProgress = values.showProgress ? '1' : '0';
  }

  try {
    storage.get(DEFAULTS, function (values) { apply(values || DEFAULTS); });
    root.chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      const values = {};
      for (const key of Object.keys(changes)) values[key] = changes[key].newValue;
      apply(values);
    });
  } catch (e) {
    /* extension context gone; leave defaults */
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
