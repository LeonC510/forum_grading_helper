// The class grader opened by a student (page_grabs/Class Video Scoring
// Student.html): Forum shows them the video tab with the "Who" selector and
// Prev/Next, but its capabilities for the class say they cannot grade
// (can_grade_polls_videos false), so the grading tools must stay away —
// no re-ordering, no Shuffle Order, no progress line, nothing stored.
// Own jsdom window: the hook keeps the first grader store it sees.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', f), 'utf8');
const URL = 'https://forum.minerva.edu/app/courses/4108/sections/13534/classes/105001/review?tab=video';
const KEY_USERS = 'fgh:order:class:4108-13534-105001:users';

// Sidebar as Forum renders it for a student on the video tab (same markup as
// for a grader; only the Release Status section below it is missing).
const SIDEBAR = `
<div class="mb4"><h2 class="body-s text-black-tint-70 ml4 mb2">Who</h2><div id="student-selector" class="pr4 pl4"><div class="current-selection"><span class="student-name">All Students</span><span class="student-detail"></span></div><div class="mt1" style="display: flex;"><button class="button-classroom-primary mr1" disabled="" type="button"><span class="prev-label">Prev</span></button><button class="button-classroom-primary" type="button"><span class="next-label">Next</span></button></div></div></div><hr>`;

// Trimmed from page_grabs/Class Video Scoring Student.har.
const STUDENT_CAPS = { can_grade_assignments: false, can_grade_polls_videos: false, can_participate_in_class: true, can_submit_assignment: true, can_view_grades: false, can_access_class_grader: true };

let win, rtk, store, slices;
const tick = () => new Promise((r) => setTimeout(r, 0));
const plain = (x) => JSON.parse(JSON.stringify(x));
const users = Array.from({ length: 16 }, (_, i) => ({ id: 200 + i, first_name: String.fromCharCode(65 + i) + 'name' }));
const alphabetical = users.map((u) => u.id);
const tools = () => win.document.querySelectorAll('.fgh-shuffle, .fgh-progress').length;

before(() => {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="app-container"><section id="col-left" class="col-left"><div class="entry-filters"></div></section></div></body></html>', {
    url: URL, runScripts: 'outside-only', pretendToBeVisual: true,
  });
  win = dom.window;
  for (const f of ['order.js', 'store-hook.js', 'class-grader.js']) win.eval(SRC(f));
  globalThis.window = win;
  rtk = require('@reduxjs/toolkit');
  const userAdapter = rtk.createEntityAdapter({ sortComparer: (a, b) => a.first_name.localeCompare(b.first_name) });
  const oa = rtk.createEntityAdapter();
  slices = {
    user: rtk.createSlice({ name: 'user', initialState: { data: userAdapter.getInitialState(), loading: false, error: null }, reducers: { upsertMany: (s, a) => { userAdapter.upsertMany(s.data, a.payload); } } }),
    outcomeAssessment: rtk.createSlice({ name: 'outcomeAssessment', initialState: { data: oa.getInitialState(), loading: false, error: null }, reducers: { upsertMany: (s, a) => { oa.upsertMany(s.data, a.payload); } } }),
    capability: rtk.createSlice({ name: 'capability', initialState: { data: null, error: null, loading: false }, reducers: { set: (s, a) => { s.data = a.payload; } } }),
    filter: rtk.createSlice({ name: 'filter', initialState: { selectedUserId: null, currentBreakoutId: null }, reducers: { setFilterValue: (s, a) => { s[a.payload.name] = a.payload.value; } } }),
  };
  store = rtk.configureStore({
    reducer: rtk.combineReducers({ user: slices.user.reducer, outcomeAssessment: slices.outcomeAssessment.reducer, capability: slices.capability.reducer, filter: slices.filter.reducer }),
    middleware: (g) => g({ immutableCheck: false, serializableCheck: false }),
  });
});

test('the sidebar renders and the class data lands before the capabilities: nothing happens yet', async () => {
  win.document.querySelector('.entry-filters').innerHTML = SIDEBAR;
  store.dispatch(slices.user.actions.upsertMany(users));
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), alphabetical);
  assert.equal(win.localStorage.getItem(KEY_USERS), null);
  assert.equal(tools(), 0);
});

test('the capabilities say the viewer cannot grade: still nothing, whatever gets scored', async () => {
  store.dispatch(slices.capability.actions.set(STUDENT_CAPS));
  store.dispatch(slices.filter.actions.setFilterValue({ name: 'selectedUserId', value: 200 })); // Forum selects the student themself
  store.dispatch(slices.outcomeAssessment.actions.upsertMany([{ id: 1, target_user_id: 200, score: 4 }]));
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), alphabetical);
  assert.equal(win.localStorage.getItem(KEY_USERS), null);
  assert.equal(tools(), 0);
});

test('a sidebar re-render (tab switch) and the popup settings change nothing either', async () => {
  const filters = win.document.querySelector('.entry-filters');
  filters.innerHTML = '';
  await tick();
  filters.innerHTML = SIDEBAR;
  await tick();
  assert.equal(tools(), 0);
  const html = win.document.documentElement;
  html.dataset.fghShuffleByDefault = '0';
  await tick();
  html.dataset.fghShuffleByDefault = '1';
  await tick();
  html.dataset.fghShowProgress = '1';
  await tick();
  assert.deepEqual(plain(store.getState().user.data.ids), alphabetical);
  assert.equal(win.localStorage.getItem(KEY_USERS), null);
  assert.equal(tools(), 0);
});

test('a stored order from an earlier visit as a grader is not applied to a student', () => {
  win.localStorage.setItem(KEY_USERS, JSON.stringify({ ids: alphabetical.slice().reverse().map(String), manual: true }));
  store.dispatch({ type: 'fgh/reorder' });
  store.dispatch(slices.user.actions.upsertMany([{ id: 300, first_name: 'Zed' }]));
  assert.deepEqual(plain(store.getState().user.data.ids), alphabetical.concat(300));
  assert.equal(tools(), 0);
});
