// Verifies the class-grader store hook against the real Redux Toolkit:
// configureStore() (devTools default) must pick up window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__
// at module-load time, exactly like Forum's class_grader bundle does.
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Simulate a pre-existing Redux DevTools compose (installed before us).
const devtoolsCalls = [];
function fakeDevtoolsCompose(options) {
  return (...enhancers) => {
    devtoolsCalls.push({ options, count: enhancers.length });
    return (createStore) => enhancers.reduceRight((acc, e) => e(acc), createStore);
  };
}
globalThis.window = globalThis;
window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = fakeDevtoolsCompose;

const Hook = require('../extension/src/store-hook.js');
const hook = Hook.install(globalThis);

// RTK must be loaded AFTER the hook is installed (it captures the global once).
const { configureStore, createSlice, createEntityAdapter, combineReducers } = require('@reduxjs/toolkit');

const userAdapter = createEntityAdapter({
  sortComparer: (a, b) => a.first_name.localeCompare(b.first_name),
});
const groupAdapter = createEntityAdapter();

function makeStore() {
  const user = createSlice({
    name: 'user',
    initialState: { data: userAdapter.getInitialState(), loading: false, error: null },
    reducers: { upsertMany: (s, a) => { userAdapter.upsertMany(s.data, a.payload); } },
  });
  const assignmentGroup = createSlice({
    name: 'assignmentGroup',
    initialState: { data: groupAdapter.getInitialState(), loading: false, error: null },
    reducers: { upsertMany: (s, a) => { groupAdapter.upsertMany(s.data, a.payload); } },
  });
  const filter = createSlice({ name: 'filter', initialState: { x: 0 }, reducers: { bump: (s) => { s.x++; } } });
  const store = configureStore({
    reducer: combineReducers({ user: user.reducer, assignmentGroup: assignmentGroup.reducer, filter: filter.reducer }),
    middleware: (g) => g({ immutableCheck: false, serializableCheck: false }),
  });
  return { store, user, assignmentGroup, filter };
}

const users = [
  { id: 1, first_name: 'Alice' },
  { id: 2, first_name: 'Bob' },
  { id: 3, first_name: 'Carol' },
];

test('configureStore reports the store and state follows the order function, not the sortComparer', () => {
  let version = 0;
  let userOrder = [3, 1, 2];
  const reported = [];
  hook.onStore((s) => reported.push(s));
  hook.setOrderer(Hook.createStateOrderer({
    slices: { user: (ids) => (ids.length ? userOrder : null), assignmentGroup: () => null },
    getVersion: () => version,
  }));
  const { store, user } = makeStore();
  assert.equal(reported[reported.length - 1], store);

  store.dispatch(user.actions.upsertMany(users));
  assert.deepEqual(store.getState().user.data.ids, [3, 1, 2]);
  const selectAll = userAdapter.getSelectors((s) => s.user.data).selectAll;
  assert.deepEqual(selectAll(store.getState()).map((u) => u.first_name), ['Carol', 'Alice', 'Bob']);
  assert.deepEqual(store.getState().assignmentGroup.data.ids, []);
});

test('unrelated actions keep root and slice references stable', () => {
  let userOrder = [2, 3, 1];
  hook.setOrderer(Hook.createStateOrderer({ slices: { user: (ids) => (ids.length ? userOrder : null) }, getVersion: () => 0 }));
  const { store, user, filter } = makeStore();
  store.dispatch(user.actions.upsertMany(users));
  const s1 = store.getState();
  store.dispatch({ type: 'totally/unknown' });
  const s2 = store.getState();
  assert.equal(s2, s1);
  store.dispatch(filter.actions.bump());
  const s3 = store.getState();
  assert.notEqual(s3, s2);
  assert.equal(s3.user, s2.user, 'user slice untouched by a filter action');
  assert.deepEqual(s3.user.data.ids, [2, 3, 1]);
});

test('bumping the version and dispatching a no-op action re-applies the new order', () => {
  let version = 0;
  let userOrder = [1, 2, 3];
  hook.setOrderer(Hook.createStateOrderer({ slices: { user: (ids) => (ids.length ? userOrder : null) }, getVersion: () => version }));
  const { store, user } = makeStore();
  store.dispatch(user.actions.upsertMany(users));
  assert.deepEqual(store.getState().user.data.ids, [1, 2, 3]);
  const before = store.getState();
  userOrder = [3, 2, 1];
  version++;
  store.dispatch({ type: 'fgh/reorder' });
  assert.notEqual(store.getState(), before);
  assert.deepEqual(store.getState().user.data.ids, [3, 2, 1]);
  assert.deepEqual(store.getState().user.data.entities, before.user.data.entities);
});

test('an order function returning null leaves the slice exactly as the reducer produced it', () => {
  hook.setOrderer(Hook.createStateOrderer({ slices: { assignmentGroup: () => null }, getVersion: () => 0 }));
  const { store, assignmentGroup } = makeStore();
  store.dispatch(assignmentGroup.actions.upsertMany([{ id: 7 }, { id: 5 }, { id: 6 }]));
  assert.deepEqual(store.getState().assignmentGroup.data.ids, [7, 5, 6]);
});

test('when the adapter re-sorts (upsert of a new entity), the order is applied again', () => {
  const seen = [];
  hook.setOrderer(Hook.createStateOrderer({
    slices: { user: (ids) => { seen.push(ids.slice()); return ids.length ? ids.slice().reverse() : null; } },
    getVersion: () => 0,
  }));
  const { store, user } = makeStore();
  store.dispatch(user.actions.upsertMany(users));
  assert.deepEqual(store.getState().user.data.ids, [3, 2, 1]);
  store.dispatch(user.actions.upsertMany([{ id: 4, first_name: 'Aaron' }]));
  // The adapter must see its own sorted ids ([1,2,3]) and insert Aaron first: [4,1,2,3];
  // our order function then reverses that => [3,2,1,4].
  assert.deepEqual(seen[seen.length - 1], [4, 1, 2, 3]);
  assert.deepEqual(store.getState().user.data.ids, [3, 2, 1, 4]);
});

test('a pre-existing DevTools compose is still invoked with the original enhancers plus ours', () => {
  assert.ok(devtoolsCalls.length > 0);
  for (const c of devtoolsCalls) {
    assert.equal(typeof c.options, 'object');
    assert.ok(c.count >= 2, 'RTK middleware enhancer + our enhancer');
  }
});

test('a DevTools compose installed after ours is picked up for later stores', () => {
  const laterCalls = [];
  window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ = (options) => (...enhancers) => {
    laterCalls.push(enhancers.length);
    return (createStore) => enhancers.reduceRight((acc, e) => e(acc), createStore);
  };
  hook.setOrderer(Hook.createStateOrderer({ slices: { user: (ids) => (ids.length ? [2, 1, 3] : null) }, getVersion: () => 0 }));
  const { store, user } = makeStore();
  assert.equal(laterCalls.length, 1);
  store.dispatch(user.actions.upsertMany(users));
  assert.deepEqual(store.getState().user.data.ids, [2, 1, 3]);
});

test('install is idempotent and does not throw when called twice', () => {
  const again = Hook.install(globalThis);
  assert.equal(again, hook);
});
