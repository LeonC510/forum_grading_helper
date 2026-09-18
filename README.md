# Forum Grading Helper

Chrome extension (Manifest V3) for professors and TAs grading on
[Forum](https://forum.minerva.edu/).

* **Random, persistent student order** in Class Poll / Video / Workbooks
  scoring and in Assignment Grading. Each class session (course / section /
  class ids) and each assignment gets its own random order on first visit,
  kept across reloads (stored only in this browser). A **Shuffle Order**
  button to the right of *Who* in the sidebar re-randomizes it. The sidebar
  dropdown, Prev/Next and the poll answer list always share the same order.
  Group selectors (group workbooks, group assignments) keep Forum's order
  until you click Shuffle Order. Switch off *Shuffle student order by
  default* in the popup and students show Forum's order too, except where
  you clicked Shuffle Order yourself; switching it back on restores the
  random orders.
* **Blind grading by default**: the class page button reads *Blind Assess
  Class* and opens the grader with `?blind=true`; on the assignment page only
  *Blind Grade Assignment* remains, styled as the primary button. Pages where
  you are a student (no *Assess Class* button) are left untouched.
* **Grading progress** under Prev/Next, e.g. `9/18 graded (50%)`: a student
  counts as graded once they have a numerical score anywhere in the class
  session (comments alone don't count); in the assignment grader, once an
  outcome score is attached. Can be switched off in the popup.
* **Comment boxes grow with your text** (never smaller than Forum's default).

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → choose the `extension/` folder of this repo.
3. Reload any open Forum tabs. Click the toolbar icon to see the version.

Requires Chrome 111+ (content scripts in the page's main world).

## How it works (short)

* `extension/src/main-app.js` — Forum's main single-page app. Routes on the
  URL and edits the entrance buttons / the assignment grader's *Who* list
  inside a `MutationObserver` callback (before paint, so nothing flickers).
  Prev/Next are re-routed through Forum's own dropdown handler.
* `extension/src/class-grader.js` + `store-hook.js` — the class grader is a
  separate React/Redux-Toolkit app. We install a store enhancer through the
  `__REDUX_DEVTOOLS_EXTENSION_COMPOSE__` hook RTK consults, and re-order the
  `user` entity ids there; every student list in that app derives from it.
* `extension/src/order.js` — shuffle / merge / storage / progress / autosize helpers.
* `extension/src/settings.js` — mirrors the popup's settings
  (`chrome.storage.local`, the only permission) onto `<html data-fgh-…>` so
  both worlds read them synchronously.
* Storage: student/group order lives in `localStorage` on forum.minerva.edu
  under `fgh:order:*` keys (the page's own storage, no permission needed);
  popup settings live in `chrome.storage.local`.

## Releasing

Merging a pull request into `main` makes GitHub Actions upload the package
to the Chrome Web Store and submit it for review — provided `version` in
`extension/manifest.json` is newer than what the store already holds
(otherwise the merge only runs the tests). Direct pushes to `main` never
deploy. See [docs/RELEASING.md](docs/RELEASING.md) for the one-time
credential setup.

## Development

```sh
npm install
npm test          # node --test: pure helpers, Redux hook against real RTK, jsdom DOM tests
npm run replay    # real Chrome + the unpacked extension against replayed Forum pages
```

`page_grabs/` holds saved Forum pages and HAR files used to derive selectors
and fixtures (`test/fixtures/` are cut from them). `npm run replay` serves
those pages and the recorded API responses over a local HTTPS server mapped
to forum.minerva.edu (`--host-resolver-rules`), loads the extension into the
installed Google Chrome (headless; `FGH_HEADFUL=1` to watch) and checks the
class grader end-to-end, the two entrance pages and the popup. The main app's
bundles are fetched at runtime and are not part of the saved pages, so the
assignment grader's Prev/Next (which go through Forum's own handler) are
verified in `test/main-app.test.js` instead.
