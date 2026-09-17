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

  const FGH = { shuffle, mergeOrder, storage, randomInt, makeShuffleButton };

  if (typeof module !== 'undefined' && module.exports) module.exports = FGH;
  else root.__forumGradingHelper = FGH;
})(typeof globalThis !== 'undefined' ? globalThis : this);
