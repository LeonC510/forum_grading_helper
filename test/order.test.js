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
