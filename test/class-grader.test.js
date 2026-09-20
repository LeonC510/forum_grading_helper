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
  slices = { user: mk('user', userAdapter), assignmentGroup: mk('assignmentGroup', plain), breakoutGroup: mk('breakoutGroup', plain), outcomeAssessment: mk('outcomeAssessment', plain) };
  slices.filter = rtk.createSlice({ name: 'filter', initialState: { selectedUserId: null, currentBreakoutId: null }, reducers: { setFilterValue: (s, a) => { s[a.payload.name] = a.payload.value; } } });
  // The viewer's class capabilities, fetched by the bundle from
  // /api/v1/roles/classes/<id>/capabilities (keys underscored; null until then).
  slices.capability = rtk.createSlice({ name: 'capability', initialState: { data: null, error: null, loading: false }, reducers: { set: (s, a) => { s.data = a.payload; } } });
  store = rtk.configureStore({
    reducer: rtk.combineReducers({ user: slices.user.reducer, assignmentGroup: slices.assignmentGroup.reducer, breakoutGroup: slices.breakoutGroup.reducer, outcomeAssessment: slices.outcomeAssessment.reducer, filter: slices.filter.reducer, capability: slices.capability.reducer }),
    middleware: (g) => g({ immutableCheck: false, serializableCheck: false }),
  });
});

// Trimmed from page_grabs/Class Video Scoring.har (an instructor).
const GRADER_CAPS = { can_grade_assignments: true, can_grade_polls_videos: true, can_access_class_grader: true, can_participate_in_class: false };

const users = Array.from({ length: 12 }, (_, i) => ({ id: 100 + i, first_name: String.fromCharCode(65 + i) + 'name' }));
const alphabetical = users.map((u) => u.id);
const KEY_USERS = 'fgh:order:class:4087-13565-104842:users';
const KEY_GROUPS = 'fgh:order:class:4087-13565-104842:groups';

// The class data (students) and the viewer's capabilities are fetched in
// parallel; until the latter say the viewer can grade, the page is a
// student's as far as we know and is left exactly as Forum made it.
test('until the capabilities land, students keep the reducer order, nothing is stored and no tools are added', async () => {
  win.document.querySelector('.entry-filters').innerHTML = STUDENT_SIDEBAR;
  store.dispatch(slices.user.actions.upsertMany(users));
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), alphabetical);
  assert.equal(win.localStorage.getItem(KEY_USERS), null);
  assert.equal(win.document.querySelector('.fgh-shuffle'), null);
  assert.equal(win.document.querySelector('.fgh-progress'), null);
});

test('once the capabilities say the viewer can grade, students are randomized, persisted, and the tools appear (no DOM change needed)', () => {
  store.dispatch(slices.capability.actions.set(GRADER_CAPS));
  const ids = store.getState().user.data.ids;
  assert.ok(win.document.querySelector('h2 > button.fgh-shuffle'), 'Shuffle Order injected from the store update');
  assert.equal(win.document.querySelector('#student-selector + .fgh-progress').textContent, '0/12 graded (0%)');
  assert.deepEqual(plain(ids).sort((a, b) => a - b), alphabetical);
  assert.notDeepEqual(plain(ids), alphabetical, 'alphabetical order must not appear (12! chance of a false failure)');
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), { ids: plain(ids).map(String), manual: false }, 'seeded, not hand-shuffled');
});

test('groups keep the reducer order until shuffled', () => {
  store.dispatch(slices.assignmentGroup.actions.upsertMany([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }, { id: 6 }]));
  store.dispatch(slices.breakoutGroup.actions.upsertMany([{ id: 9 }, { id: 8 }, { id: 7 }]));
  assert.deepEqual(plain(store.getState().assignmentGroup.data.ids), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(plain(store.getState().breakoutGroup.data.ids), [9, 8, 7]);
  assert.equal(win.localStorage.getItem(KEY_GROUPS), null);
});

test('no Shuffle button without a student selector', async () => {
  win.document.querySelector('.entry-filters').innerHTML = '';
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
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), { ids: plain(ids).map(String), manual: true }, 'hand-shuffled');
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
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)).ids, userIds.map(String), 'students untouched by a group shuffle');
});

// A second store the way a page reload would create one (the hook keeps the
// first grader store for the button, so only the ordering is exercised).
// The capabilities are in already, as they normally are before the class data.
function reloadedStore(caps = GRADER_CAPS) {
  const s = rtk.configureStore({
    reducer: rtk.combineReducers({ user: slices.user.reducer, assignmentGroup: slices.assignmentGroup.reducer, breakoutGroup: slices.breakoutGroup.reducer, capability: slices.capability.reducer }),
    middleware: (g) => g({ immutableCheck: false, serializableCheck: false }),
  });
  if (caps) s.dispatch(slices.capability.actions.set(caps));
  return s;
}

test('a viewer who cannot grade (a student on the video tab) keeps the reducer order on every load, and nothing is stored', () => {
  const stored = win.localStorage.getItem(KEY_USERS);
  const s2 = reloadedStore({ ...GRADER_CAPS, can_grade_polls_videos: false, can_grade_assignments: false, can_participate_in_class: true });
  s2.dispatch(slices.user.actions.upsertMany(users));
  assert.deepEqual(plain(s2.getState().user.data.ids), alphabetical, 'even though this browser has a stored order for the session');
  assert.equal(win.localStorage.getItem(KEY_USERS), stored, 'storage untouched');
});

test('a stored order is applied on a later load instead of a fresh shuffle', () => {
  const stored = JSON.parse(win.localStorage.getItem(KEY_USERS)).ids;
  const s2 = reloadedStore();
  s2.dispatch(slices.user.actions.upsertMany(users));
  assert.deepEqual(plain(s2.getState().user.data.ids).map(String), stored);
});

test('an order saved by an earlier version (plain array) is applied as-is', () => {
  const legacy = alphabetical.slice().reverse().map(String);
  win.localStorage.setItem(KEY_USERS, JSON.stringify(legacy));
  const s2 = reloadedStore();
  s2.dispatch(slices.user.actions.upsertMany(users));
  assert.deepEqual(plain(s2.getState().user.data.ids).map(String), legacy);
  win.localStorage.setItem(KEY_USERS, JSON.stringify({ ids: stored(), manual: false }));
});
const stored = () => JSON.parse(win.localStorage.getItem(KEY_USERS)).ids;

// ------------------------------------------------------------ progress line

const progressEl = () => win.document.querySelector('#student-selector + .fgh-progress');

test('progress line appears under Prev/Next: students with a numerical score / all students', async () => {
  win.document.querySelector('.entry-filters').innerHTML = STUDENT_SIDEBAR;
  store.dispatch(slices.outcomeAssessment.actions.upsertMany([
    { id: 1, target_user_id: 100, score: 4, type: 'poll' },
    { id: 2, target_user_id: 100, score: 3, type: 'video' },        // same student twice: counts once
    { id: 3, target_user_id: 101, score: 0, type: 'poll' },         // 0 is a score
    { id: 4, target_user_id: 102, score: null, comment: 'nice' },   // comment only: not graded
    { id: 5, target_user_id: 9999, score: 5 },                      // not in the list: ignored
  ]));
  await tick();
  const el = progressEl();
  assert.ok(el, 'inserted right after #student-selector');
  assert.equal(el.textContent, '2/12 graded (17%)');
  assert.ok(el.classList.contains('text-black-tint-70') && el.classList.contains('body-s') && el.classList.contains('pl4'), 'plain sidebar text style');
  assert.equal(win.document.querySelectorAll('.fgh-progress').length, 1);
});

test('progress line updates live when a score is saved', async () => {
  store.dispatch(slices.outcomeAssessment.actions.upsertMany([{ id: 6, target_user_id: 103, score: 2 }]));
  assert.equal(progressEl().textContent, '3/12 graded (25%)');
  store.dispatch(slices.outcomeAssessment.actions.upsertMany([{ id: 6, target_user_id: 103, score: null }]));
  assert.equal(progressEl().textContent, '2/12 graded (17%)');
});

test('the popup setting hides and re-shows the line', async () => {
  win.document.documentElement.dataset.fghShowProgress = '0';
  await tick();
  assert.equal(progressEl(), null);
  store.dispatch(slices.outcomeAssessment.actions.upsertMany([{ id: 7, target_user_id: 104, score: 1 }]));
  assert.equal(progressEl(), null, 'stays hidden while off');
  win.document.documentElement.dataset.fghShowProgress = '1';
  await tick();
  assert.equal(progressEl().textContent, '3/12 graded (25%)');
});

test('group selector: groups with a score / groups shown (assignment groups, or the current breakout\'s groups)', async () => {
  win.document.querySelector('.entry-filters').innerHTML = GROUP_SIDEBAR;
  store.dispatch(slices.outcomeAssessment.actions.upsertMany([
    { id: 8, target_assignment_group_id: 2, score: 3 },
    { id: 9, target_breakout_group_id: 8, score: 4 },
  ]));
  await tick();
  assert.equal(progressEl().textContent, '1/6 graded (17%)');
  store.dispatch(slices.breakoutGroup.actions.upsertMany([{ id: 7, breakout_id: 5 }, { id: 8, breakout_id: 5 }, { id: 9, breakout_id: 6 }]));
  store.dispatch(slices.filter.actions.setFilterValue({ name: 'currentBreakoutId', value: 5 }));
  assert.equal(progressEl().textContent, '1/2 graded (50%)');
  store.dispatch(slices.filter.actions.setFilterValue({ name: 'currentBreakoutId', value: null }));
  assert.equal(progressEl().textContent, '1/6 graded (17%)');
});

test('progress line is re-created when the sidebar re-renders', async () => {
  const filters = win.document.querySelector('.entry-filters');
  filters.innerHTML = '';
  await tick();
  filters.innerHTML = STUDENT_SIDEBAR;
  await tick();
  assert.equal(progressEl().textContent, '3/12 graded (25%)');
  assert.equal(win.document.querySelectorAll('.fgh-progress').length, 1);
});

// ------------------------------------------------------- comment textareas

function addTextarea(container, initialScroll) {
  container.insertAdjacentHTML('beforeend', '<div class="response-comment"><textarea placeholder="Your comment"></textarea></div>');
  const ta = container.querySelector('textarea:last-of-type');
  let h = initialScroll;
  Object.defineProperty(ta, 'scrollHeight', { get: () => h });
  return { ta, setScroll: (v) => { h = v; } };
}

test('comment textareas grow to fit their text when they appear and while typing', async () => {
  const col = win.document.createElement('section');
  col.id = 'col-right';
  win.document.body.appendChild(col);
  const { ta, setScroll } = addTextarea(col, 90);
  await tick();
  assert.equal(ta.dataset.fghAutosize, '1');
  assert.equal(ta.style.height, '90px');
  setScroll(150);
  ta.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(ta.style.height, '150px');
});


// ------------------------------- "Shuffle student order by default" setting

const html = () => win.document.documentElement;

test('setting off: a session with no stored order keeps the reducer order and stores nothing', () => {
  html().dataset.fghShuffleByDefault = '0';
  win.localStorage.removeItem(KEY_USERS);
  const s3 = reloadedStore();
  s3.dispatch(slices.user.actions.upsertMany(users));
  assert.deepEqual(plain(s3.getState().user.data.ids), alphabetical);
  assert.equal(win.localStorage.getItem(KEY_USERS), null);
});

test('setting off: an order the user shuffled by hand is still applied', () => {
  const manual = alphabetical.slice().reverse().map(String);
  win.localStorage.setItem(KEY_USERS, JSON.stringify({ ids: manual, manual: true }));
  const s4 = reloadedStore();
  s4.dispatch(slices.user.actions.upsertMany(users));
  assert.deepEqual(plain(s4.getState().user.data.ids).map(String), manual);
});

test('setting off: a seeded order (this version, or a plain array from an earlier one) is ignored but kept', () => {
  const seeded = alphabetical.slice().reverse().map(String);
  for (const raw of [{ ids: seeded, manual: false }, seeded]) {
    win.localStorage.setItem(KEY_USERS, JSON.stringify(raw));
    const s5 = reloadedStore();
    s5.dispatch(slices.user.actions.upsertMany(users));
    assert.deepEqual(plain(s5.getState().user.data.ids), alphabetical, 'reducer order');
    assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), raw, 'storage untouched');
  }
  win.localStorage.removeItem(KEY_USERS);
});

test('setting off: Shuffle Order is still offered and re-randomizes the students', async () => {
  win.document.querySelector('.entry-filters').innerHTML = STUDENT_SIDEBAR;
  await tick();
  const btn = win.document.querySelector('h2 > button.fgh-shuffle');
  assert.ok(btn, 'button still offered');
  const before = store.getState().user.data.ids.slice();
  let changed = false;
  for (let i = 0; i < 5 && !changed; i++) {
    btn.click();
    changed = store.getState().user.data.ids.join() !== before.join();
  }
  assert.ok(changed);
  const ids = store.getState().user.data.ids;
  assert.deepEqual(plain(ids).sort((a, b) => a - b), alphabetical);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), { ids: plain(ids).map(String), manual: true });
});

test('switching the setting on seeds an unseeded session right away; off puts the reducer order back (the seeded one is kept for later)', async () => {
  win.localStorage.removeItem(KEY_USERS); // as if this session had never been shuffled
  html().dataset.fghShuffleByDefault = '1';
  await tick();
  const ids = plain(store.getState().user.data.ids);
  assert.deepEqual(ids.slice().sort((a, b) => a - b), alphabetical);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), { ids: ids.map(String), manual: false }, 'seeded and persisted');
  html().dataset.fghShuffleByDefault = '0';
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), alphabetical, 'reducer order while off');
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), { ids: ids.map(String), manual: false }, 'seeded order kept in storage');
  html().dataset.fghShuffleByDefault = '1';
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), ids, 'same seeded order again when on');
});

test('setting off: a hand shuffle sticks through later toggles', async () => {
  html().dataset.fghShuffleByDefault = '0';
  await tick();
  win.document.querySelector('h2 > button.fgh-shuffle').click();
  const ids = plain(store.getState().user.data.ids);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY_USERS)), { ids: ids.map(String), manual: true });
  html().dataset.fghShuffleByDefault = '1';
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), ids);
  html().dataset.fghShuffleByDefault = '0';
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), ids);
});
