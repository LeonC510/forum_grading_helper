// Forum Grading Helper — Forum's main app (isolated world, document_start).
//
// The main app is a single-page app, so this script is injected on every
// /app/* page and decides what to do from location.pathname:
//   * class entrance      → "Assess Class" becomes "Blind Assess Class" and
//                           opens the grader with ?blind=true
//   * assignment entrance → hide "Grade Assignment", make "Blind Grade
//                           Assignment" the primary button
//   * assignment grader   → random, persisted gradee order in the "Who" list;
//                           Prev/Next follow it; "Shuffle Order" button
// All DOM edits happen in a MutationObserver callback (a microtask that runs
// after the app commits and before the browser paints), so nothing flickers.
(function (root) {
  'use strict';

  const FGH = root.__forumGradingHelper;
  if (!FGH) return;
  const doc = root.document;

  // Small seam for tests (jsdom cannot navigate).
  const api = { navigate: function (url) { root.location.assign(url); } };
  root.__forumGradingHelperMainApp = api;

  const ROUTES = [
    { name: 'classEntrance', re: /^\/app\/courses\/(\d+)\/sections\/(\d+)\/classes\/(\d+)\/?$/ },
    { name: 'assignmentEntrance', re: /^\/app\/assignments\/(\d+)\/?$/ },
    { name: 'assignmentGrader', re: /^\/app\/assignment-grader\/(\d+)(?:\/(users|groups)\/(\d+))?(?:\/assessments\/\d+)?\/?$/ },
  ];

  let lastPath = null;
  let route = null; // { name, m } or null
  // Per visit to an assignment grader: did the URL name a gradee when we
  // arrived? If not, Forum auto-selects its own fixed first gradee and we
  // move the selection to the first student of the random order (once).
  let graderVisit = null;

  function resolveRoute() {
    const p = root.location.pathname;
    if (p === lastPath) return;
    lastPath = p;
    route = null;
    for (const r of ROUTES) {
      const m = r.re.exec(p);
      if (m) { route = { name: r.name, m: m }; break; }
    }
    if (route && route.name === 'assignmentGrader') {
      const id = route.m[1];
      // A bare grader URL (no gradee) always starts a fresh visit: Forum is
      // about to pick its own first gradee. Otherwise keep the visit going
      // while the user moves between gradees of the same assignment.
      if (!route.m[2]) graderVisit = { assignmentId: id, hadGradee: false, selected: false };
      else if (!graderVisit || graderVisit.assignmentId !== id) graderVisit = { assignmentId: id, hadGradee: true, selected: false };
    } else {
      graderVisit = null;
    }
  }

  function textNodeWith(el, text) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim() === text) return n;
    return null;
  }

  // ---------------------------------------------------------------- class entrance

  function applyClassEntrance(m) {
    const target = '/app/courses/' + m[1] + '/sections/' + m[2] + '/classes/' + m[3] + '/review?blind=true';
    for (const btn of doc.querySelectorAll('button.assess-class:not([data-fgh])')) {
      // Only the real "Assess Class" button (students get "Enter Class" only).
      const text = textNodeWith(btn, 'Assess Class');
      if (!text) continue;
      text.nodeValue = 'Blind Assess Class';
      btn.dataset.fgh = 'blind-assess';
      btn.dataset.fghHref = target;
    }
  }

  // ----------------------------------------------------------- assignment entrance

  function applyAssignmentEntrance(m) {
    const graderPath = '/app/assignment-grader/' + m[1];
    for (const view of doc.querySelectorAll('.action-view:not([data-fgh])')) {
      let gradeBtn = null;
      let blindBtn = null;
      for (const btn of view.querySelectorAll('a[href*="' + graderPath + '"] > button')) {
        const href = btn.parentElement.getAttribute('href') || '';
        const label = btn.textContent.trim();
        if (label === 'Grade Assignment' && href.indexOf('blind') < 0) gradeBtn = btn;
        else if (label === 'Blind Grade Assignment' && href.indexOf('blind=true') >= 0) blindBtn = btn;
      }
      // Only rewrite when Forum offers both choices.
      if (!gradeBtn || !blindBtn) continue;
      gradeBtn.parentElement.hidden = true;
      gradeBtn.parentElement.style.display = 'none';
      blindBtn.classList.remove('icon-button-secondary');
      blindBtn.classList.add('icon-button-primary', 'fgh-blind-primary');
      view.dataset.fgh = 'blind-default';
    }
  }

  // ------------------------------------------------------------- assignment grader

  function gradeeItems(sel) {
    return Array.prototype.slice.call(sel.querySelectorAll('.dropdown-list > .list-item.gradee[data-gradee-id]'));
  }

  // Drive Forum's own dropdown handler: with the selector "open", a click on
  // a .gradee item selects it (and re-renders the panel + updates the URL).
  function selectGradee(sel, item) {
    sel.classList.add('open');
    item.click();
  }

  function stepGradee(delta) {
    tick(); // make sure a freshly re-rendered list is already in our order
    const sel = doc.getElementById('student-selector');
    if (!sel) return;
    const items = gradeeItems(sel);
    if (!items.length) return;
    const cur = sel.querySelector('.current-selection');
    const curId = cur ? cur.dataset.gradeeId : undefined;
    let idx = -1;
    for (let i = 0; i < items.length; i++) if (items[i].dataset.gradeeId === curId) { idx = i; break; }
    idx = idx < 0 ? (delta > 0 ? 0 : items.length - 1) : (idx + delta + items.length) % items.length;
    selectGradee(sel, items[idx]);
  }

  function applyAssignmentGrader(m) {
    const sel = doc.getElementById('student-selector');
    if (!sel || !sel.classList.contains('choose-gradee')) return;
    const key = 'fgh:order:assignment:' + m[1];
    const type = m[2]; // 'users' | 'groups' | undefined (not rendered yet)
    const list = sel.querySelector('.dropdown-list');

    if (list && !list.dataset.fghOrdered && type) {
      const items = gradeeItems(sel);
      const ids = items.map(function (el) { return el.dataset.gradeeId; });
      const stored = FGH.storage.get(key);
      // Students: random from the first render. Groups: only once shuffled.
      if (stored || type === 'users') {
        const result = FGH.mergeOrder(stored, ids);
        if (result.changed) FGH.storage.set(key, result.stored);
        const byId = new Map(items.map(function (el) { return [el.dataset.gradeeId, el]; }));
        for (const id of result.order) list.appendChild(byId.get(id));
      }
      list.dataset.fghOrdered = '1';

      if (type === 'users' && graderVisit && !graderVisit.hadGradee && !graderVisit.selected) {
        graderVisit.selected = true;
        const first = gradeeItems(sel)[0];
        const cur = sel.querySelector('.current-selection');
        if (first && cur && cur.dataset.gradeeId !== first.dataset.gradeeId) selectGradee(sel, first);
      }
    }

    const h2 = sel.previousElementSibling;
    if (!h2 || h2.tagName !== 'H2' || h2.querySelector('.fgh-shuffle') || h2.textContent.trim() !== 'Who') return;
    h2.appendChild(FGH.makeShuffleButton(doc, {
      onClick: function () {
        const s = doc.getElementById('student-selector');
        const l = s && s.querySelector('.dropdown-list');
        if (!l) return;
        FGH.storage.set(key, FGH.shuffle(gradeeItems(s).map(function (el) { return el.dataset.gradeeId; })));
        delete l.dataset.fghOrdered;
        tick();
      },
    }));
  }

  // ------------------------------------------------------------------- wiring

  function tick() {
    resolveRoute();
    if (!route) return;
    if (route.name === 'classEntrance') applyClassEntrance(route.m);
    else if (route.name === 'assignmentEntrance') applyAssignmentEntrance(route.m);
    else if (route.name === 'assignmentGrader') applyAssignmentGrader(route.m);
  }

  // Capture at document level: runs before React's root listener and before
  // Backbone's delegated handlers, so the app's own handler never fires.
  doc.addEventListener('click', function (e) {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const blind = t.closest('button[data-fgh="blind-assess"]');
    if (blind) {
      if (blind.disabled) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      api.navigate(blind.dataset.fghHref);
      return;
    }
    resolveRoute();
    if (route && route.name === 'assignmentGrader') {
      const nav = t.closest('.adjacent-submissions .prev-button, .adjacent-submissions .next-button');
      if (nav) {
        e.stopImmediatePropagation();
        e.preventDefault();
        stepGradee(nav.classList.contains('next-button') ? 1 : -1);
      }
    }
  }, true);

  function observe() {
    new root.MutationObserver(tick).observe(doc.documentElement, { childList: true, subtree: true });
    tick();
  }
  if (doc.documentElement) observe();
  else doc.addEventListener('DOMContentLoaded', observe, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
