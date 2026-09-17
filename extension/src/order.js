// Forum Grading Helper — pure helpers shared by both content scripts.
// Plain script (no modules) so it can be listed before the other content
// scripts in manifest.json; also exports for the Node test-suite.
(function (root) {
  'use strict';

  function randomInt(n) {
    // uniform integer in [0, n)
    if (n <= 1) return 0;
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n; // rejection sampling: no modulo bias
    let x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= limit);
    return x % n;
  }

  // Fisher–Yates; returns a new array.
  function shuffle(ids) {
    const out = ids.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const t = out[i];
      out[i] = out[j];
      out[j] = t;
    }
    return out;
  }

  // Reconcile a stored order (array of id strings, or null) with the ids the
  // page currently has. Known ids keep their stored relative order; ids that
  // are new are inserted at random positions (so a missing/late id never
  // leaks the page's default order); stored ids that are currently absent are
  // kept in `stored` for later but left out of `order`.
  // Returns { order: ids reordered (original types), stored: new stored list, changed }.
  function mergeOrder(stored, ids) {
    const merged = Array.isArray(stored) ? stored.map(String) : [];
    const known = new Set(merged);
    let changed = false;
    for (const id of ids) {
      const key = String(id);
      if (known.has(key)) continue;
      merged.splice(randomInt(merged.length + 1), 0, key);
      known.add(key);
      changed = true;
    }
    const byKey = new Map();
    for (const id of ids) byKey.set(String(id), id);
    const order = [];
    for (const key of merged) if (byKey.has(key)) order.push(byKey.get(key));
    return { order, stored: merged, changed };
  }

  // localStorage JSON wrapper; every access is guarded because storage can be
  // blocked/absent and must never break the page.
  const storage = {
    get(key) {
      try {
        const raw = root.localStorage.getItem(key);
        return raw == null ? null : JSON.parse(raw);
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        root.localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        /* ignore */
      }
    },
  };

  // <button class="fgh-shuffle …"><span class="fgh-icon"/> Shuffle Order</button>
  // Plain text that inherits the sidebar heading's typography; the icon is a
  // CSS mask in currentColor (see shared.css), so it needs no font or asset.
  function makeShuffleButton(doc, opts) {
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'fgh-shuffle' + (opts.className ? ' ' + opts.className : '');
    btn.title = 'Randomize the order for this session';
    const icon = doc.createElement('span');
    icon.className = 'fgh-icon';
    icon.setAttribute('aria-hidden', 'true');
    btn.appendChild(icon);
    btn.appendChild(doc.createTextNode(' Shuffle Order'));
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      opts.onClick();
    });
    return btn;
  }

  // "13/15 graded (87%)"
  function progressText(graded, total) {
    const pct = total ? Math.round((graded / total) * 100) : 0;
    return graded + '/' + total + ' graded (' + pct + '%)';
  }

  // Insert (or update) the progress line right after `anchor`.
  function renderProgress(doc, anchor, opts) {
    let el = anchor.nextElementSibling;
    if (!el || !el.classList.contains('fgh-progress')) {
      el = doc.createElement('div');
      el.className = 'fgh-progress' + (opts.className ? ' ' + opts.className : '');
      anchor.insertAdjacentElement('afterend', el);
    }
    const text = progressText(opts.graded, opts.total);
    if (el.textContent !== text) el.textContent = text;
    return el;
  }

  function removeProgress(anchor) {
    const el = anchor.nextElementSibling;
    if (el && el.classList.contains('fgh-progress')) el.remove();
  }

  // Grow/shrink a textarea to fit its content, never below the height Forum's
  // CSS gave it (recorded on first sight, before we set any inline height).
  // The inline height is reset before measuring so the result reflects the
  // current text; scrollHeight is content + padding, so padding/borders are
  // adjusted per box-sizing.
  function autosize(ta, win) {
    const view = win || ta.ownerDocument.defaultView;
    let cs = view.getComputedStyle(ta);
    if (!ta.dataset.fghAutosize) {
      ta.dataset.fghAutosize = '1';
      ta.dataset.fghBaseHeight = String(parseFloat(cs.height) || 0);
    }
    const px = function (v) { return parseFloat(v) || 0; };
    ta.style.height = 'auto';
    cs = view.getComputedStyle(ta);
    let h = ta.scrollHeight;
    if (cs.boxSizing === 'border-box') h += px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    else h -= px(cs.paddingTop) + px(cs.paddingBottom);
    ta.style.height = Math.max(h, px(ta.dataset.fghBaseHeight)) + 'px';
  }

  // Keep every matching textarea under `root` sized to its text: once when it
  // shows up (existing comments) and on every keystroke.
  function installAutosize(doc, opts) {
    const selector = opts.selector || 'textarea';
    const exclude = opts.exclude || null;
    const enabled = opts.enabled || function () { return true; };
    const wanted = function (el) { return enabled() && el && el.tagName === 'TEXTAREA' && el.matches(selector) && !(exclude && el.closest(exclude)); };
    doc.addEventListener('input', function (e) { if (wanted(e.target)) autosize(e.target); }, true);
    return function sweep() {
      for (const ta of doc.querySelectorAll(selector + ':not([data-fgh-autosize])')) if (wanted(ta)) autosize(ta);
    };
  }

  const FGH = { shuffle, mergeOrder, storage, randomInt, makeShuffleButton, progressText, renderProgress, removeProgress, autosize, installAutosize };

  if (typeof module !== 'undefined' && module.exports) module.exports = FGH;
  else root.__forumGradingHelper = FGH;
})(typeof globalThis !== 'undefined' ? globalThis : this);
