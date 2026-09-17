// Forum Grading Helper — class grader (Polls / Video / Workbooks tabs).
// Runs in the page's MAIN world at document_start so the Redux hook is in
// place before Forum's class_grader bundle creates its store.
//
// Ordering: every student list in this app (sidebar dropdown, Prev/Next, the
// poll "Submitted Answers" list, "Assess Multiple") derives from the `user`
// entity adapter's `ids`, so re-ordering that array in the store re-orders
// the whole UI consistently. Students get a random, persisted order on first
// load; breakout/assignment groups keep Forum's order until "Shuffle Order".
(function (root) {
  'use strict';

  const FGH = root.__forumGradingHelper;
  const StoreHook = root.__forumGradingHelperStoreHookModule;
  if (!FGH || !StoreHook) return;

  const match = /^\/app\/courses\/(\d+)\/sections\/(\d+)\/classes\/(\d+)\/review(?:\/|$)/.exec(root.location.pathname);
  if (!match) return;

  const sessionKey = match[1] + '-' + match[2] + '-' + match[3];
  const KEY_USERS = 'fgh:order:class:' + sessionKey + ':users';
  const KEY_GROUPS = 'fgh:order:class:' + sessionKey + ':groups';
  const GROUP_SLICES = ['assignmentGroup', 'breakoutGroup'];
  const TAG = '[Forum Grading Helper]';

  let store = null;
  let version = 0;
  let warned = false;

  // Students: first load seeds a random order (mergeOrder with nothing stored
  // inserts every id at a random position) and persists it.
  function userOrder(ids) {
    const result = FGH.mergeOrder(FGH.storage.get(KEY_USERS), ids);
    if (result.changed) FGH.storage.set(KEY_USERS, result.stored);
    return result.order;
  }

  // Groups: only re-ordered once the user has shuffled them.
  function groupOrder(slice) {
    return function (ids) {
      const all = FGH.storage.get(KEY_GROUPS);
      if (!all || !Array.isArray(all[slice])) return null;
      const result = FGH.mergeOrder(all[slice], ids);
      if (result.changed) {
        const next = Object.assign({}, all);
        next[slice] = result.stored;
        FGH.storage.set(KEY_GROUPS, next);
      }
      return result.order;
    };
  }

  const hook = StoreHook.install(root);
  hook.setOrderer(StoreHook.createStateOrderer({
    slices: {
      user: userOrder,
      assignmentGroup: groupOrder('assignmentGroup'),
      breakoutGroup: groupOrder('breakoutGroup'),
    },
    getVersion: function () { return version; },
  }));
  // Forum creates one store; keep the first one that has the grader's slices.
  function isGraderStore(s) {
    try { const st = s.getState(); return !!(st && st.user && st.user.data); } catch (e) { return false; }
  }
  hook.onStore(function (s) {
    if (!store || (!isGraderStore(store) && isGraderStore(s))) store = s;
  });

  function sliceIds(state, name) {
    return (state && state[name] && state[name].data && state[name].data.ids) || [];
  }

  // Bumping the version invalidates the orderer's memo; the no-op action makes
  // the reducer run so the new order flows out to react-redux.
  function reorder() {
    version++;
    store.dispatch({ type: 'fgh/reorder' });
  }

  function shuffleStudents() {
    FGH.storage.set(KEY_USERS, FGH.shuffle(sliceIds(store.getState(), 'user')).map(String));
    reorder();
  }

  function shuffleGroups() {
    const state = store.getState();
    const saved = {};
    for (const name of GROUP_SLICES) saved[name] = FGH.shuffle(sliceIds(state, name)).map(String);
    FGH.storage.set(KEY_GROUPS, saved);
    reorder();
  }

  // Add "Shuffle Order" to the right of the "Who" heading that precedes
  // #student-selector. The heading is React-managed but React only owns its
  // text node, so an appended button survives re-renders; if the heading is
  // unmounted (tab switch) the observer simply injects again.
  function inject() {
    const doc = root.document;
    const sel = doc.getElementById('student-selector');
    if (!sel) return;
    const h2 = sel.previousElementSibling;
    if (!h2 || h2.tagName !== 'H2' || h2.querySelector('.fgh-shuffle') || h2.textContent.trim() !== 'Who') return;
    if (!store) {
      if (!warned) { warned = true; console.warn(TAG, 'Redux store not captured; Shuffle Order unavailable.'); }
      return;
    }
    const isGroupSelector = !!sel.querySelector('.group-name');
    h2.appendChild(FGH.makeShuffleButton(doc, {
      className: 'mr4', // line up with the selector's pr4
      onClick: isGroupSelector ? shuffleGroups : shuffleStudents,
    }));
  }

  function observe() {
    new root.MutationObserver(inject).observe(root.document.documentElement, { childList: true, subtree: true });
    inject();
  }
  if (root.document.documentElement) observe();
  else root.document.addEventListener('DOMContentLoaded', observe, { once: true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
