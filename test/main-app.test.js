// Integration tests for extension/src/main-app.js (isolated-world content
// script for Forum's main SPA): class entrance, assignment entrance and the
// assignment grader. Fixtures are real markup from page_grabs/.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const SRC = (f) => fs.readFileSync(path.join(__dirname, '..', 'extension', 'src', f), 'utf8');
const FIX = (f) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 0));

let dom, win, doc, main, navigations;

function goto(pathAndQuery) {
  // SPA navigation: Forum uses pushState/replaceState, never a reload.
  win.history.pushState({}, '', pathAndQuery);
}

before(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body><div class="main-region"></div></body></html>', {
    url: 'https://forum.minerva.edu/app/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  win = dom.window;
  doc = win.document;
  for (const f of ['order.js', 'main-app.js']) win.eval(SRC(f));
  main = win.__forumGradingHelperMainApp;
  assert.ok(main, 'script exposes a small test hook');
  navigations = [];
  main.navigate = (url) => navigations.push(url); // jsdom cannot navigate
});

beforeEach(() => {
  doc.querySelector('.main-region').innerHTML = '';
  navigations.length = 0;
});

// ---------------------------------------------------------------- class entrance

test('class entrance: "Assess Class" becomes "Blind Assess Class", icon and siblings untouched', async () => {
  goto('/app/courses/4087/sections/13565/classes/104842');
  doc.querySelector('.main-region').innerHTML = FIX('class-entrance-buttons.html');
  await tick();
  const btn = doc.querySelector('button.assess-class');
  assert.equal(btn.textContent, 'Blind Assess Class');
  assert.ok(btn.querySelector('span.svg-icon.assess-class'), 'icon kept');
  assert.equal(btn.className, 'icon-button-primary root-0-2-36 root-d6-0-2-179 assess-class');
  assert.equal(doc.querySelector('button.enter-class').textContent, 'Enter Class');
});

test('class entrance: click navigates to /review?blind=true and suppresses the original handler', async () => {
  goto('/app/courses/4087/sections/13565/classes/104842');
  doc.querySelector('.main-region').innerHTML = FIX('class-entrance-buttons.html');
  await tick();
  let originalFired = 0;
  // React attaches its handlers at the root container in the bubble phase.
  doc.querySelector('.main-region').addEventListener('click', () => originalFired++);
  doc.querySelector('button.assess-class').click();
  assert.deepEqual(navigations, ['/app/courses/4087/sections/13565/classes/104842/review?blind=true']);
  assert.equal(originalFired, 0);
  doc.querySelector('button.enter-class').click();
  assert.equal(originalFired, 1, 'other buttons still reach the app');
  assert.equal(navigations.length, 1);
});

test('class entrance: a student page (no "Assess Class" button) is left alone', async () => {
  goto('/app/courses/4089/sections/13504/classes/105172');
  doc.querySelector('.main-region').innerHTML = FIX('class-entrance-buttons.html').split('<div class="tooltip" title=""><button class="icon-button-primary')[0];
  const before = doc.querySelector('.main-region').innerHTML;
  await tick();
  assert.equal(doc.querySelector('.main-region').innerHTML, before);
});

test('class entrance: a same-class button with different text is not touched', async () => {
  goto('/app/courses/4087/sections/13565/classes/104842');
  doc.querySelector('.main-region').innerHTML = '<button class="icon-button-primary assess-class" type="button"><span class="svg-icon assess-class"></span>View Assessment</button>';
  await tick();
  assert.equal(doc.querySelector('button').textContent, 'View Assessment');
  doc.querySelector('button').click();
  assert.deepEqual(navigations, []);
});

test('unrelated /app pages are not touched even if similar markup appears', async () => {
  goto('/app/classes/104842');
  doc.querySelector('.main-region').innerHTML = FIX('class-entrance-buttons.html') + FIX('assignment-entrance-actions.html');
  await tick();
  assert.equal(doc.querySelector('button.assess-class').textContent, 'Assess Class');
  assert.equal(doc.querySelector('button.grade-assignment').closest('a').hidden, false);
});

// ----------------------------------------------------------- assignment entrance

test('assignment entrance: plain "Grade Assignment" is hidden and the blind button becomes primary', async () => {
  goto('/app/assignments/2491635');
  doc.querySelector('.main-region').innerHTML = FIX('assignment-entrance-actions.html');
  await tick();
  const gradeLink = doc.querySelector('button.grade-assignment').closest('a');
  assert.equal(gradeLink.hidden, true);
  assert.equal(gradeLink.style.display, 'none', 'inline style: immune to site CSS setting display on links');
  const blind = doc.querySelector('a[href$="?blind=true"] > button');
  assert.equal(blind.textContent, 'Blind Grade Assignment');
  assert.ok(blind.classList.contains('icon-button-primary'));
  assert.ok(!blind.classList.contains('icon-button-secondary'));
  assert.ok(blind.classList.contains('fgh-blind-primary'), 'hook for the icon colour fix in shared.css');
  assert.ok(blind.querySelector('.svg-icon.grade-blind'), 'blind icon kept');
  assert.equal(blind.closest('a').getAttribute('href'), 'https://forum.minerva.edu/app/assignment-grader/2491635?blind=true');
  const notes = doc.querySelector('a[target="_blank"] > button');
  assert.ok(notes.classList.contains('icon-button-secondary'), 'other buttons untouched');
});

test('assignment entrance: nothing changes when the blind button is absent', async () => {
  goto('/app/assignments/2491635');
  const html = FIX('assignment-entrance-actions.html').replace(/<a href="[^"]*blind=true"[\s\S]*?<\/a>/, '');
  doc.querySelector('.main-region').innerHTML = html;
  await tick();
  assert.equal(doc.querySelector('button.grade-assignment').closest('a').hidden, false);
});

test('assignment entrance: nothing changes when the plain button is absent (student view)', async () => {
  goto('/app/assignments/2491635');
  const html = FIX('assignment-entrance-actions.html').replace(/<a href="[^"]*assignment-grader\/2491635" class[\s\S]*?<\/a>/, '');
  doc.querySelector('.main-region').innerHTML = html;
  await tick();
  const blind = doc.querySelector('a[href$="?blind=true"] > button');
  assert.ok(blind.classList.contains('icon-button-secondary'));
});

// ------------------------------------------------------------- assignment grader

const KEY = 'fgh:order:assignment:2491635';
const GRADEES = ['10893', '12429', '12898', '12915', '12928'];

// Minimal stand-in for Forum's LeftSidebarWhoPanelView behaviour: delegated
// handlers on the panel root, and a full re-render on selection.
function mountWhoPanel(selectedId, log) {
  const region = doc.querySelector('.main-region');
  region.innerHTML = FIX('assignment-grader-who-panel.html').replace(/<div class="current-selection" data-gradee-id="10893">/, `<div class="current-selection" data-gradee-id="${selectedId}">`);
  const panel = region.firstElementChild;
  panel.addEventListener('click', (e) => {
    const sel = panel.querySelector('.choose-gradee');
    if (e.target.closest('.prev-button')) { log.push('forum-prev'); return; }
    if (e.target.closest('.next-button')) { log.push('forum-next'); return; }
    if (e.target.closest('.choose-gradee')) {
      if (sel.classList.contains('open')) {
        const id = e.target.closest('.gradee') && e.target.closest('.gradee').dataset.gradeeId;
        sel.classList.remove('open');
        log.push('select:' + id);
        win.history.replaceState({}, '', `/app/assignment-grader/2491635/users/${id}?blind=true`);
        mountWhoPanel(id, log); // Forum re-renders the whole panel
      } else {
        sel.classList.add('open');
      }
    }
  });
}
const listIds = () => [...doc.querySelectorAll('.dropdown-list > .list-item.gradee')].map((el) => el.dataset.gradeeId);

test('assignment grader: gradees are randomized on first render and persisted', async () => {
  win.localStorage.removeItem(KEY);
  goto('/app/assignment-grader/2491635/users/10893?blind=true');
  const log = [];
  mountWhoPanel('10893', log);
  await tick();
  const ids = listIds();
  assert.deepEqual(ids.slice().sort(), GRADEES);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY)), ids);
  assert.deepEqual(log, [], 'no selection change on an ordinary render');
});

test('assignment grader: the same order is re-applied when the panel re-renders', async () => {
  goto('/app/assignment-grader/2491635/users/12429?blind=true');
  const stored = JSON.parse(win.localStorage.getItem(KEY));
  const log = [];
  mountWhoPanel('12429', log);
  await tick();
  assert.deepEqual(listIds(), stored);
});

test('assignment grader: Shuffle Order sits in the "Who" heading, uses Forum\'s reload icon, and re-randomizes', async () => {
  goto('/app/assignment-grader/2491635/users/12429?blind=true');
  win.localStorage.setItem(KEY, JSON.stringify(GRADEES));
  mountWhoPanel('12429', []);
  await tick();
  const btn = doc.querySelector('h2 > button.fgh-shuffle');
  assert.ok(btn);
  assert.equal(btn.previousSibling.nodeValue, 'Who');
  assert.ok(btn.querySelector('span.fgh-icon[aria-hidden="true"]'));
  assert.equal(doc.querySelectorAll('.fgh-shuffle').length, 1);
  let changed = false;
  for (let i = 0; i < 6 && !changed; i++) {
    btn.click();
    changed = listIds().join() !== GRADEES.join();
  }
  assert.ok(changed);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEY)), listIds());
  assert.deepEqual(listIds().slice().sort(), GRADEES);
});

test('assignment grader: Prev/Next follow the random order, wrap, and go through Forum\'s own dropdown handler', async () => {
  const order = ['12915', '10893', '12928', '12429', '12898'];
  win.localStorage.setItem(KEY, JSON.stringify(order));
  goto('/app/assignment-grader/2491635/users/12928?blind=true');
  const log = [];
  mountWhoPanel('12928', log);
  await tick();
  assert.deepEqual(listIds(), order);

  doc.querySelector('.next-button').click();
  await tick();
  assert.deepEqual(log, ['select:12429']);
  assert.deepEqual(listIds(), order, 're-render keeps the order');
  assert.equal(doc.querySelector('.choose-gradee').classList.contains('open'), false);

  doc.querySelector('.prev-button').click();
  doc.querySelector('.prev-button').click();
  await tick();
  assert.deepEqual(log, ['select:12429', 'select:12928', 'select:10893']);

  // wrap-around both ways
  doc.querySelector('.prev-button').click();
  doc.querySelector('.prev-button').click();
  assert.equal(log[log.length - 1], 'select:12898');
  doc.querySelector('.next-button').click();
  assert.equal(log[log.length - 1], 'select:12915');
  assert.ok(!log.includes('forum-prev') && !log.includes('forum-next'), 'original Prev/Next handlers never run');
});

test('assignment grader: entering without a gradee in the URL selects the first of the random order', async () => {
  const order = ['12915', '10893', '12928', '12429', '12898'];
  win.localStorage.setItem(KEY, JSON.stringify(order));
  goto('/app/assignment-grader/2491635?blind=true');
  doc.querySelector('.main-region').innerHTML = '<div class="loading">Loading...</div>';
  await tick();
  // Forum picks its own first gradee, rewrites the URL, then renders.
  win.history.replaceState({}, '', '/app/assignment-grader/2491635/users/10893?blind=true');
  const log = [];
  mountWhoPanel('10893', log);
  await tick();
  assert.deepEqual(log, ['select:12915']);
  assert.equal(doc.querySelector('.current-selection').dataset.gradeeId, '12915');
  // A later ordinary re-render must not select again.
  mountWhoPanel('12915', log);
  await tick();
  assert.deepEqual(log, ['select:12915']);
});

test('assignment grader: entering with a gradee in the URL does not change the selection', async () => {
  win.localStorage.setItem(KEY, JSON.stringify(['12915', '10893', '12928', '12429', '12898']));
  goto('/app/assignments/2491635');
  await tick();
  goto('/app/assignment-grader/2491635/users/10893?blind=true');
  const log = [];
  mountWhoPanel('10893', log);
  await tick();
  assert.deepEqual(log, []);
});

test('assignment grader: group assignments keep the default order until Shuffle is clicked', async () => {
  const KEYG = 'fgh:order:assignment:777';
  win.localStorage.removeItem(KEYG);
  goto('/app/assignment-grader/777?blind=true');
  await tick();
  win.history.replaceState({}, '', '/app/assignment-grader/777/groups/10893?blind=true');
  const log = [];
  mountWhoPanel('10893', log);
  await tick();
  assert.deepEqual(listIds(), GRADEES, 'default order kept');
  assert.equal(win.localStorage.getItem(KEYG), null);
  assert.deepEqual(log, [], 'no auto-selection for groups');
  const btn = doc.querySelector('h2 > button.fgh-shuffle');
  assert.ok(btn, 'button still offered');
  let changed = false;
  for (let i = 0; i < 6 && !changed; i++) { btn.click(); changed = listIds().join() !== GRADEES.join(); }
  assert.ok(changed);
  assert.deepEqual(JSON.parse(win.localStorage.getItem(KEYG)), listIds());
  // Prev/Next follow the shuffled group order too.
  const order = listIds();
  doc.querySelector('.next-button').click();
  assert.equal(log[log.length - 1], 'select:' + order[(order.indexOf('10893') + 1) % order.length]);
});
