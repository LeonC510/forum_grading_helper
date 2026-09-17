// extension/popup/popup.js: shows the manifest name/version and binds each
// settings checkbox to its chrome.storage.local key (defaults on).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const POPUP = path.join(__dirname, '..', 'extension', 'popup');
const HTML = fs.readFileSync(path.join(POPUP, 'popup.html'), 'utf8');
const SRC = fs.readFileSync(path.join(POPUP, 'popup.js'), 'utf8');
// Objects made inside the jsdom realm have another Object prototype; compare by value.
const plain = (x) => JSON.parse(JSON.stringify(x));

function boot(stored) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
  const win = dom.window;
  const writes = [];
  win.chrome = {
    runtime: { getManifest: () => ({ name: 'Forum Grading Helper', version: '9.9.9' }) },
    storage: {
      local: {
        get: (defaults, cb) => { cb(Object.assign({}, defaults, stored)); },
        set: (values) => { writes.push(values); },
      },
    },
  };
  win.eval(SRC);
  return { doc: win.document, win, writes };
}

test('shows the manifest name and version', () => {
  const { doc } = boot({});
  assert.equal(doc.getElementById('name').textContent, 'Forum Grading Helper');
  assert.equal(doc.getElementById('version').textContent, '9.9.9');
});

test('both settings are on by default', () => {
  const { doc } = boot({});
  assert.equal(doc.getElementById('showProgress').checked, true);
  assert.equal(doc.getElementById('shuffleByDefault').checked, true);
});

test('"Shuffle student order by default" reflects the stored value and is labelled', () => {
  const { doc } = boot({ shuffleByDefault: false });
  const box = doc.getElementById('shuffleByDefault');
  assert.equal(box.checked, false);
  assert.equal(doc.getElementById('showProgress').checked, true, 'other setting unaffected');
  assert.equal(box.closest('label').textContent.trim(), 'Shuffle student order by default');
});

test('toggling a checkbox writes only that key', () => {
  const { doc, win, writes } = boot({});
  const box = doc.getElementById('shuffleByDefault');
  box.checked = false;
  box.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual(plain(writes), [{ shuffleByDefault: false }]);
  const progress = doc.getElementById('showProgress');
  progress.checked = false;
  progress.dispatchEvent(new win.Event('change', { bubbles: true }));
  assert.deepEqual(plain(writes), [{ shuffleByDefault: false }, { showProgress: false }]);
});
