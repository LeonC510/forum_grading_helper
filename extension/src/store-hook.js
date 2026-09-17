// Forum Grading Helper — Redux store hook for the class grader (MAIN world).
//
// Forum's class grader builds its store with Redux Toolkit's configureStore()
// and leaves `devTools` at its default (true), so RTK reads
// window.__REDUX_DEVTOOLS_EXTENSION_COMPOSE__ when its bundle evaluates.
// Installing our own compose there (before the bundles run) lets us add a
// store enhancer that wraps the root reducer and re-orders entity `ids`
// arrays — no DOM manipulation needed. A real Redux DevTools compose, whether
// installed before or after us, keeps working.
(function (root) {
  'use strict';

  const PROP = '__REDUX_DEVTOOLS_EXTENSION_COMPOSE__';
  const KEY = '__forumGradingHelperStoreHook';

  // Build a state transformer `(state) => state` that reorders
  // `state[slice].data.ids` per `slices[slice](ids)` (returns the desired order
  // or null to leave the slice alone). Results are memoized on slice/root
  // references plus `getVersion()` so unrelated actions keep references stable
  // and a version bump forces a recompute.
  function createStateOrderer(config) {
    const slices = config.slices || {};
    const getVersion = config.getVersion || function () { return 0; };
    const names = Object.keys(slices);
    const memo = Object.create(null);
    let rootMemo = { input: null, version: -1, output: null };

    function normalize(order, ids) {
      const byKey = new Map();
      for (const id of ids) byKey.set(String(id), id);
      const out = [];
      const used = new Set();
      for (const o of order) {
        const key = String(o);
        if (byKey.has(key) && !used.has(key)) { out.push(byKey.get(key)); used.add(key); }
      }
      for (const id of ids) if (!used.has(String(id))) out.push(id);
      return out;
    }

    function sameOrder(a, b) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
      return true;
    }

    function orderSlice(slice, name, version) {
      const m = memo[name];
      if (m && m.input === slice && m.version === version) return m.output;
      let output = slice;
      const ids = slice && slice.data && slice.data.ids;
      if (Array.isArray(ids) && ids.length) {
        let order = null;
        try { order = slices[name](ids); } catch (e) { console.error('[Forum Grading Helper]', e); }
        if (Array.isArray(order)) {
          order = normalize(order, ids);
          if (!sameOrder(order, ids)) {
            output = Object.assign({}, slice, { data: Object.assign({}, slice.data, { ids: order }) });
          }
        }
      }
      memo[name] = { input: slice, version, output };
      return output;
    }

    return function applyOrder(state) {
      if (!state || typeof state !== 'object') return state;
      const version = getVersion();
      if (rootMemo.input === state && rootMemo.version === version) return rootMemo.output;
      let output = state;
      for (const name of names) {
        if (!(name in state)) continue;
        const ordered = orderSlice(state[name], name, version);
        if (ordered !== state[name]) {
          if (output === state) output = Object.assign({}, state);
          output[name] = ordered;
        }
      }
      rootMemo = { input: state, version, output };
      return output;
    };
  }

  // Install the compose hook on `target` (the page window). Idempotent.
  // Returns { setOrderer(fn), onStore(fn), enhancer }.
  function install(target) {
    if (target[KEY]) return target[KEY];

    let orderer = function (s) { return s; };
    const storeListeners = [];
    let realCompose = null;

    // Our output state -> the reducer's own output it was derived from. The
    // app's reducers always receive their own state back (RTK's sorted entity
    // adapter relies on `ids` being sorted for incremental inserts); only what
    // leaves the reducer is re-ordered.
    const originals = new WeakMap();
    const wrap = function (r) {
      return function (state, action) {
        const input = state && typeof state === 'object' ? originals.get(state) || state : state;
        const next = r(input, action);
        const output = orderer(next);
        if (output !== next && output && typeof output === 'object') originals.set(output, next);
        return output;
      };
    };

    // Outermost enhancer: the reducer we wrap flows down unchanged through
    // applyMiddleware etc., and the store we see is the one configureStore
    // returns (with middleware-aware dispatch).
    const enhancer = function (createStore) {
      return function (reducer, preloadedState) {
        const store = createStore(wrap(reducer), preloadedState);
        const replaceReducer = store.replaceReducer;
        store.replaceReducer = function (r) { return replaceReducer.call(store, wrap(r)); };
        for (const listener of storeListeners) {
          try { listener(store); } catch (e) { console.error('[Forum Grading Helper]', e); }
        }
        return store;
      };
    };

    function composeAll(enhancers, options) {
      const all = [enhancer].concat(enhancers);
      if (typeof realCompose === 'function') return realCompose(options || {}).apply(null, all);
      return function (createStore) {
        return all.reduceRight(function (acc, e) { return e(acc); }, createStore);
      };
    }

    // RTK calls compose(options)(...enhancers); plain Redux calls compose(...enhancers).
    function ourCompose() {
      const args = Array.prototype.slice.call(arguments);
      const isOptionsCall = args.length === 0 || (args.length === 1 && typeof args[0] === 'object' && args[0] !== null);
      if (isOptionsCall) {
        const options = args[0];
        return function () { return composeAll(Array.prototype.slice.call(arguments), options); };
      }
      return composeAll(args, undefined);
    }

    const existing = target[PROP];
    if (typeof existing === 'function' && existing !== ourCompose) realCompose = existing;
    try {
      Object.defineProperty(target, PROP, {
        configurable: true,
        enumerable: true,
        get: function () { return ourCompose; },
        set: function (v) { realCompose = typeof v === 'function' && v !== ourCompose ? v : null; },
      });
    } catch (e) {
      target[PROP] = ourCompose;
    }

    const api = {
      setOrderer: function (fn) { orderer = typeof fn === 'function' ? fn : function (s) { return s; }; },
      onStore: function (fn) { storeListeners.push(fn); },
      enhancer: enhancer,
    };
    try {
      Object.defineProperty(target, KEY, { value: api, configurable: true, enumerable: false, writable: false });
    } catch (e) {
      target[KEY] = api;
    }
    return api;
  }

  const StoreHook = { install, createStateOrderer };
  if (typeof module !== 'undefined' && module.exports) module.exports = StoreHook;
  else root.__forumGradingHelperStoreHookModule = StoreHook;
})(typeof globalThis !== 'undefined' ? globalThis : this);
