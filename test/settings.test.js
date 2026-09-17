// extension/src/settings.js: mirrors the popup's settings (chrome.storage.local)
// onto <html data-fgh-…> attributes so both worlds can read them synchronously.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', 'settings.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

function boot(stored) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://forum.minerva.edu/app/', runScripts: 'outside-only' });
  const win = dom.window;
  const listeners = [];
  win.chrome = {
    storage: {
      local: { get: (defaults, cb) => { cb(Object.assign({}, defaults, stored)); } },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  win.eval(SRC);
  return { win, fire: (changes, area) => listeners.forEach((fn) => fn(changes, area)) };
}

test('defaults to showing progress when nothing is stored', async () => {
  const { win } = boot({});
  await tick();
  assert.equal(win.document.documentElement.dataset.fghShowProgress, '1');
});

test('reflects a stored "off" setting', async () => {
  const { win } = boot({ showProgress: false });
  await tick();
  assert.equal(win.document.documentElement.dataset.fghShowProgress, '0');
});

test('follows changes made in the popup while the page is open', async () => {
  const { win, fire } = boot({});
  await tick();
  fire({ showProgress: { oldValue: true, newValue: false } }, 'local');
  assert.equal(win.document.documentElement.dataset.fghShowProgress, '0');
  fire({ showProgress: { oldValue: false, newValue: true } }, 'local');
  assert.equal(win.document.documentElement.dataset.fghShowProgress, '1');
  fire({ other: { newValue: 1 } }, 'local');
  assert.equal(win.document.documentElement.dataset.fghShowProgress, '1');
});

test('survives a missing chrome.storage (e.g. extension reloaded under the page)', async () => {
  const dom = new JSDOM('<!DOCTYPE html><html></html>', { url: 'https://forum.minerva.edu/app/', runScripts: 'outside-only' });
  dom.window.chrome = {};
  assert.doesNotThrow(() => dom.window.eval(SRC));
  await tick();
  assert.equal(dom.window.document.documentElement.dataset.fghShowProgress, undefined);
});
