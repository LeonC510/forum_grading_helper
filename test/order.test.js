const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// The content scripts are plain (non-module) scripts; order.js also exports for Node.
const FGH = require('../extension/src/order.js');

function fakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

beforeEach(() => {
  globalThis.localStorage = fakeLocalStorage();
});

test('shuffle returns a permutation of the input without mutating it', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const copy = ids.slice();
  const out = FGH.shuffle(ids);
  assert.deepEqual(ids, copy);
  assert.deepEqual(out.slice().sort((a, b) => a - b), copy);
});

test('shuffle actually changes the order (over many runs)', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  let different = 0;
  for (let i = 0; i < 50; i++) if (FGH.shuffle(ids).join() !== ids.join()) different++;
  assert.ok(different > 40);
});

test('mergeOrder keeps the stored order for known ids', () => {
  const { order, changed } = FGH.mergeOrder(['3', '1', '2'], [1, 2, 3]);
  assert.deepEqual(order, [3, 1, 2]);
  assert.equal(changed, false);
});

test('mergeOrder returns ids in their original type', () => {
  const { order } = FGH.mergeOrder(['b', 'a'], ['a', 'b']);
  assert.deepEqual(order, ['b', 'a']);
  const num = FGH.mergeOrder(['20', '10'], [10, 20]).order;
  assert.deepEqual(num, [20, 10]);
});

test('mergeOrder inserts unknown ids and reports a change', () => {
  const { order, stored, changed } = FGH.mergeOrder(['3', '1'], [1, 2, 3]);
  assert.equal(changed, true);
  assert.deepEqual(order.slice().sort(), [1, 2, 3]);
  assert.equal(order.indexOf(3) < order.indexOf(1), true, 'known ids keep relative order');
  assert.deepEqual(stored.filter((s) => s !== '2'), ['3', '1']);
  assert.ok(stored.includes('2'));
});

test('mergeOrder keeps stored ids that are currently missing (for later), but not in order', () => {
  const { order, stored, changed } = FGH.mergeOrder(['9', '3', '1'], [1, 3]);
  assert.deepEqual(order, [3, 1]);
  assert.deepEqual(stored, ['9', '3', '1']);
  assert.equal(changed, false);
});

test('mergeOrder with no stored order yields a random permutation and a change', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8];
  const { order, stored, changed } = FGH.mergeOrder(null, ids);
  assert.equal(changed, true);
  assert.deepEqual(order.slice().sort((a, b) => a - b), ids);
  assert.deepEqual(stored, order.map(String));
  let different = 0;
  for (let i = 0; i < 50; i++) if (FGH.mergeOrder(null, ids).order.join() !== ids.join()) different++;
  assert.ok(different > 40);
});

test('mergeOrder with an empty current list returns an empty order', () => {
  const { order, changed } = FGH.mergeOrder(['1', '2'], []);
  assert.deepEqual(order, []);
  assert.equal(changed, false);
});

test('storage round-trips JSON and returns null when absent or corrupt', () => {
  assert.equal(FGH.storage.get('fgh:x'), null);
  FGH.storage.set('fgh:x', ['1', '2']);
  assert.deepEqual(FGH.storage.get('fgh:x'), ['1', '2']);
  localStorage.setItem('fgh:y', '{not json');
  assert.equal(FGH.storage.get('fgh:y'), null);
});

test('storage.get tolerates a missing localStorage', () => {
  delete globalThis.localStorage;
  assert.equal(FGH.storage.get('fgh:x'), null);
  assert.doesNotThrow(() => FGH.storage.set('fgh:x', [1]));
});

test('loadOrder: nothing stored → no ids, not manual', () => {
  assert.deepEqual(FGH.loadOrder('fgh:o'), { ids: null, manual: false });
});

test('saveOrder/loadOrder round-trip the ids and the manual flag', () => {
  FGH.saveOrder('fgh:o', ['3', '1', '2'], true);
  assert.deepEqual(FGH.loadOrder('fgh:o'), { ids: ['3', '1', '2'], manual: true });
  FGH.saveOrder('fgh:o', ['2', '3', '1'], false);
  assert.deepEqual(FGH.loadOrder('fgh:o'), { ids: ['2', '3', '1'], manual: false });
  assert.deepEqual(JSON.parse(localStorage.getItem('fgh:o')), { ids: ['2', '3', '1'], manual: false });
});

test('loadOrder: an order saved by earlier versions (plain array) counts as seeded, not manual', () => {
  localStorage.setItem('fgh:o', JSON.stringify(['1', '2']));
  assert.deepEqual(FGH.loadOrder('fgh:o'), { ids: ['1', '2'], manual: false });
});

test('loadOrder: corrupt or unexpected values read as nothing stored', () => {
  localStorage.setItem('fgh:o', '{not json');
  assert.deepEqual(FGH.loadOrder('fgh:o'), { ids: null, manual: false });
  localStorage.setItem('fgh:o', JSON.stringify({ manual: true }));
  assert.deepEqual(FGH.loadOrder('fgh:o'), { ids: null, manual: false });
  localStorage.setItem('fgh:o', JSON.stringify(42));
  assert.deepEqual(FGH.loadOrder('fgh:o'), { ids: null, manual: false });
});

test('progressText formats "graded/total graded (percent)" with a rounded percent', () => {
  assert.equal(FGH.progressText(13, 15), '13/15 graded (87%)');
  assert.equal(FGH.progressText(0, 18), '0/18 graded (0%)');
  assert.equal(FGH.progressText(18, 18), '18/18 graded (100%)');
  assert.equal(FGH.progressText(0, 0), '0/0 graded (0%)');
});

test('renderProgress creates the line once, then updates it in place', () => {
  const { JSDOM } = require('jsdom');
  const doc = new JSDOM('<div id="sidebar"><div id="student-selector"></div><hr></div>').window.document;
  const anchor = doc.getElementById('student-selector');
  const el = FGH.renderProgress(doc, anchor, { graded: 3, total: 10, className: 'pl4' });
  assert.equal(el.className, 'fgh-progress pl4');
  assert.equal(el.textContent, '3/10 graded (30%)');
  assert.equal(anchor.nextElementSibling, el, 'inserted right after the anchor');
  const again = FGH.renderProgress(doc, anchor, { graded: 4, total: 10, className: 'pl4' });
  assert.equal(again, el);
  assert.equal(el.textContent, '4/10 graded (40%)');
  assert.equal(doc.querySelectorAll('.fgh-progress').length, 1);
  FGH.removeProgress(anchor);
  assert.equal(doc.querySelector('.fgh-progress'), null);
});

test('autosize grows a textarea to its content height (border-box aware) and marks it', () => {
  const { JSDOM } = require('jsdom');
  const win = new JSDOM('<textarea rows="2"></textarea>').window;
  const ta = win.document.querySelector('textarea');
  let content = 120;
  Object.defineProperty(ta, 'scrollHeight', { get: () => content });
  // jsdom has no layout: stub the computed style the way a browser reports it.
  const fakeWin = { getComputedStyle: () => ({ boxSizing: 'border-box', borderTopWidth: '1px', borderBottomWidth: '1px' }) };
  FGH.autosize(ta, fakeWin);
  assert.equal(ta.style.height, '122px');
  assert.equal(ta.dataset.fghAutosize, '1');
  content = 60;
  FGH.autosize(ta, fakeWin);
  assert.equal(ta.style.height, '62px', 'shrinks too (height reset before measuring)');
  FGH.autosize(ta, { getComputedStyle: () => ({ boxSizing: 'content-box', borderTopWidth: '1px', borderBottomWidth: '1px', paddingTop: '8px', paddingBottom: '8px' }) });
  assert.equal(ta.style.height, '44px', 'content-box: height excludes padding and borders');
});

test('autosize never shrinks a textarea below the height Forum gave it', () => {
  const { JSDOM } = require('jsdom');
  const win = new JSDOM('<textarea></textarea>').window;
  const ta = win.document.querySelector('textarea');
  let content = 30;
  Object.defineProperty(ta, 'scrollHeight', { get: () => content });
  const fakeWin = { getComputedStyle: () => ({ boxSizing: 'border-box', borderTopWidth: '1px', borderBottomWidth: '1px', height: '70px' }) };
  FGH.autosize(ta, fakeWin); // first call records the 70px base
  assert.equal(ta.style.height, '70px');
  content = 200;
  FGH.autosize(ta, fakeWin);
  assert.equal(ta.style.height, '202px');
  content = 30;
  FGH.autosize(ta, { getComputedStyle: () => ({ boxSizing: 'border-box', borderTopWidth: '1px', borderBottomWidth: '1px', height: '202px' }) });
  assert.equal(ta.style.height, '70px', 'base is the original height, not our own inline one');
});
