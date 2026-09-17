// Integration test for extension/src/class-grader.js: runs the real content
// scripts inside a jsdom window at a class-grader URL, then builds a Redux
// Toolkit store the way Forum's class_grader bundle does and drives the DOM.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', f), 'utf8');
const URL = 'https://forum.minerva.edu/app/courses/4087/sections/13565/classes/104842/review?blind=true';

// Sidebar markup as rendered by Forum (see page_grabs/Class Poll Scoring.htm).
const STUDENT_SIDEBAR = `
<div class="mb4"><h2 class="body-s text-black-tint-70 ml4 mb2">Who</h2><div id="student-selector" class="pr4 pl4"><div class="current-selection"><span class="student-name">All Students</span><span class="student-detail"></span></div><div class="mt1" style="display: flex;"><button class="button-classroom-primary mr1" disabled="" type="button"><span class="prev-label">Prev</span></button><button class="button-classroom-primary" type="button"><span class="next-label">Next</span></button></div></div></div>`;
// Group-workbook variant (see page_grabs/Class Workbooks Scoring.html).
const GROUP_SIDEBAR = `
<h2 class="body-s text-black-tint-70 ml4 mb2">Who</h2><div id="student-selector" class="pr4 pl4"><div class="dropdown display-none"><div><span class="student-name" title="Select a group">Select a group</span></div></div><div class=""><div class="current-selection"><span class="group-name">Group 1</span><span class="student-detail"></span></div></div></div><hr>`;

let dom, win, rtk, store, slices;
const tick = () => new Promise((r) => setTimeout(r, 0));
// Arrays produced inside the jsdom realm have a different Array prototype; compare by value.
const plain = (x) => JSON.parse(JSON.stringify(x));

before(() => {
  dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app-container"><section id="col-left" class="col-left"><div class="entry-filters"></div></section></div></body></html>', {
    url: URL,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  win = dom.window;
  // Content scripts run at document_start in the MAIN world, in this order.
  for (const f of ['order.js', 'store-hook.js', 'class-grader.js']) win.eval(SRC(f));
  // RTK reads window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ at load time.
  globalThis.window = win;
  rtk = require('@reduxjs/toolkit');

  const userAdapter = rtk.createEntityAdapter({ sortComparer: (a, b) => a.first_name.localeCompare(b.first_name) });
  const plain = rtk.createEntityAdapter();
  const mk = (name, adapter) => rtk.createSlice({
    name,
    initialState: { data: adapter.getInitialState(), loading: false, error: null },
    reducers: { upsertMany: (s, a) => { adapter.upsertMany(s.data, a.payload); } },
  });
  slices = { user: mk('user', userAdapter), assignmentGroup: mk('assignmentGroup', plain), breakoutGroup: mk('breakoutGroup', plain) };
  const filter = rtk.createSlice({ name: 'filter', initialState: { selectedUserId: null }, reducers: {} });
  store = rtk.configureStore({
    reducer: rtk.combineReducers({ user: slices.user.reducer, assignmentGroup: slices.assignmentGroup.reducer, breakoutGroup: slices.breakoutGroup.reducer, filter: filter.reducer }),
    middleware: (g) => g({ immutableCheck: false, serializableCheck: false }),
  });
});

const users = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, first_name: String.fromCharCode(65 + i) + 'name' }));
const alphabetical = users.map((u) => u.id);
const KEY_USERS = 'fgh:order:class:4087-13565-104842:users';
const KEY_GROUPS = 'fgh:order:class:4087-13565-104842:groups';

test('students are randomized on first load and the order is persisted', () => {
  store.dispatch(slices.user.actions.upsertMany(users));
  const ids = store.getState().user.data.ids;
  assert.deepEqual(plain(ids).sort((a, b) => a - b), alphabetical);
  assert.notDeepEqual(plain(ids), alphabetical, 'alphabetical order must not appear (12! chance of a false failure)');
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), plain(ids).map(String));
});

test('groups keep the reducer order until shuffled', () => {
  store.dispatch(slices.assignmentGroup.actions.upsertMany([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }]));
  store.dispatch(slices.breakoutGroup.actions.upsertMany([{ id: 9 }, { id: 8 }, { id: 7 }]));
  assert.deepEqual(plain(store.getState().assignmentGroup.data.ids), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(plain(store.getState().breakoutGroup.data.ids), [9, 8, 7]);
  assert.equal(win.localStorage.getItem(KEY_GROUPS), null);
});

test('no Shuffle button without a student selector (non-grader view)', async () => {
  await tick();
  assert.equal(win.document.querySelector('.fgh-shuffle'), null);
});

test('Shuffle Order button is injected into the "Who" heading of the student selector', async () => {
  win.document.querySelector('.entry-filters').innerHTML = STUDENT_SIDEBAR;
  await tick();
  const btn = win.document.querySelector('h2 > button.fgh-shuffle');
  assert.ok(btn, 'button inside the h2');
  assert.equal(btn.previousSibling.nodeValue, 'Who');
  assert.equal(btn.textContent.trim(), 'Shuffle Order');
  assert.ok(btn.querySelector('span.fgh-icon[aria-hidden="true"]'), 'self-contained circle-arrow icon (CSS mask, currentColor)');
  assert.ok(btn.classList.contains('mr4'));
  assert.equal(win.document.querySelectorAll('.fgh-shuffle').length, 1);
  await tick();
  assert.equal(win.document.querySelectorAll('.fgh-shuffle').length, 1, 'not injected twice');
});

test('clicking Shuffle Order re-randomizes students, persists, and re-renders via the store', async () => {
  const before = store.getState().user.data.ids.slice();
  let notified = 0;
  const unsub = store.subscribe(() => notified++);
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    win.document.querySelector('.fgh-shuffle').click();
    changed = store.getState().user.data.ids.join() !== before.join();
  }
  unsub();
  assert.ok(changed);
  assert.ok(notified > 0, 'subscribers (react-redux) were notified');
  const ids = store.getState().user.data.ids;
  assert.deepEqual(plain(ids).sort((a, b) => a - b), alphabetical);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), plain(ids).map(String));
  assert.deepEqual(plain(store.getState().assignmentGroup.data.ids), [1, 2, 3, 4, 5, 6], 'groups untouched by a student shuffle');
});

test('button is re-injected when the sidebar is re-rendered (tab switch)', async () => {
  const filters = win.document.querySelector('.entry-filters');
  filters.innerHTML = '';
  await tick();
  filters.innerHTML = STUDENT_SIDEBAR;
  await tick();
  assert.equal(win.document.querySelectorAll('h2 > .fgh-shuffle').length, 1);
});

test('group selector gets the button; groups are shuffled only on click and then persisted', async () => {
  win.document.querySelector('.entry-filters').innerHTML = GROUP_SIDEBAR;
  await tick();
  const btn = win.document.querySelector('h2 > button.fgh-shuffle');
  assert.ok(btn);
  assert.deepEqual(plain(store.getState().assignmentGroup.data.ids), [1, 2, 3, 4, 5, 6], 'still default before click');
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    btn.click();
    changed = store.getState().assignmentGroup.data.ids.join() !== '1,2,3,4,5,6';
  }
  assert.ok(changed);
  const ag = plain(store.getState().assignmentGroup.data.ids);
  const bg = plain(store.getState().breakoutGroup.data.ids);
  assert.deepEqual(ag.slice().sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(bg.slice().sort(), [7, 8, 9]);
  const saved = JSON.parse(win.localStorage.getItem(KEY_GROUPS));
  assert.deepEqual(saved, { assignmentGroup: ag.map(String), breakoutGroup: bg.map(String) });
  const userIds = plain(store.getState().user.data.ids);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), userIds.map(String), 'students untouched by a group shuffle');
});

test('a stored order is applied on a later load instead of a fresh shuffle', () => {
  const stored = JSON.parse(win.localStorage.getItem(KEY_USERS));
  // Re-create a store like a page reload would; storage already has an order.
  const s2 = rtk.configureStore({
    reducer: rtk.combineReducers({ user: slices.user.reducer, assignmentGroup: slices.assignmentGroup.reducer, breakoutGroup: slices.breakoutGroup.reducer }),
    middleware: (g) => g({ immutableCheck: false, serializableCheck: false }),
  });
  s2.dispatch(slices.user.actions.upsertMany(users));
  assert.deepEqual(plain(s2.getState().user.data.ids).map(String), stored);
});
