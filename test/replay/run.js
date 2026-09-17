// Dev-only end-to-end check: real Chrome + the unpacked extension + the
// replay server (saved Forum pages and recorded API responses).
//   npm run replay            (FGH_HEADFUL=1 to watch; FGH_CHROME=<path> to pick a binary)
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');

// Self-signed cert for forum.minerva.edu / assets.minerva.edu (Chrome runs
// with --ignore-certificate-errors); generated once into test/replay/.certs.
if (!process.env.FGH_CERT_DIR) {
  const dir = path.join(__dirname, '.certs');
  if (!fs.existsSync(path.join(dir, 'cert.pem'))) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
      '-subj', '/CN=forum.minerva.edu', '-addext', 'subjectAltName=DNS:forum.minerva.edu,DNS:assets.minerva.edu', '-days', '365'], { stdio: 'ignore' });
  }
  process.env.FGH_CERT_DIR = dir;
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // this process fetches the replay server too

const EXT = path.resolve(__dirname, '..', '..', 'extension');
const CHROME = process.env.FGH_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.FGH_PORT || 8443);
const GRADER = 'https://forum.minerva.edu/app/courses/4087/sections/13565/classes/104842/review?blind=true';
const KEY_USERS = 'fgh:order:class:4087-13565-104842:users';
const KEY_GROUPS = 'fgh:order:class:4087-13565-104842:groups';

const results = [];
function check(name, fn) {
  return Promise.resolve().then(fn).then(
    () => { results.push(['PASS', name]); console.log('PASS', name); },
    (e) => { results.push(['FAIL', name, e]); console.log('FAIL', name, '\n   ', e.message); },
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openDropdown(page) {
  await page.click('#student-selector .current-selection');
  await page.waitForSelector('#student-selector .dropdown [data-testid]');
  const ids = await page.$$eval('#student-selector .dropdown [data-testid]', (els) => els.map((e) => e.dataset.testid).filter((t) => t !== 'all-students'));
  await page.click('#student-selector .dropdown [data-testid="all-students"]');
  await page.waitForSelector('#student-selector .current-selection');
  return ids;
}
const mainScreenIds = (page) => page.$$eval('#poll-col section.poll:first-of-type .response-name', (els) => els.map((e) => e.textContent.replace(/^User /, '')));
const groupDropdown = (page) => page.$$eval('#student-selector .dropdown .student-name', (els) => els.map((e) => e.title).filter((t) => t !== 'Select a group'));

(async () => {
  const server = require('./server');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.FGH_HEADFUL ? false : true,
    enableExtensions: [EXT], // CDP Extensions.loadUnpacked (branded Chrome ≥137 ignores --load-extension)
    args: [
      `--host-resolver-rules=MAP forum.minerva.edu 127.0.0.1:${PORT}, MAP assets.minerva.edu 127.0.0.1:${PORT}`,
      '--ignore-certificate-errors', '--no-first-run', '--no-default-browser-check',
    ],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    // Forum's own bug: a click-outside handler in class_grader.bundle keeps a
    // document listener after its ref is gone ("Cannot read ... 'contains'").
    if (/reading 'contains'/.test(e.message) && /class_grader\.bundle/.test(e.stack || '')) return;
    errors.push('pageerror: ' + e.message);
  });
  page.on('console', (m) => { if (m.type() === 'error' && !/net::ERR|Failed to load resource|404|integrity|VIDEOJS: ERROR/.test(m.text())) errors.push('console: ' + m.text()); });

  // Alphabetical (Forum's default) order from the recorded class API.
  const classJson = await (await fetch(`https://127.0.0.1:${PORT}/api/v1/class_grader/classes/104842`, { headers: { host: 'forum.minerva.edu' } }).catch(() => null))?.json?.().catch(() => null) ?? null;
  const alphabetical = classJson ? classJson.class_users.map((c) => c.user).sort((a, b) => a.first_name.localeCompare(b.first_name)).map((u) => String(u.id)) : null;

  await page.goto(GRADER, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#student-selector', { timeout: 30000 });
  await page.waitForSelector('#poll-col section.poll .response-name', { timeout: 30000 });

  let order;
  await check('class grader: dropdown order is a non-alphabetical permutation, persisted in localStorage', async () => {
    order = await openDropdown(page);
    assert.ok(order.length >= 5, 'has students: ' + order.length);
    if (alphabetical) {
      assert.deepEqual(order.slice().sort(), alphabetical.slice().sort());
      assert.notDeepEqual(order, alphabetical);
    }
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY_USERS);
    assert.deepEqual(stored, order);
  });

  await check('class grader: poll main screen lists students in the same order as the sidebar', async () => {
    const ids = await mainScreenIds(page);
    assert.deepEqual(ids, order.filter((id) => ids.includes(id)));
    assert.ok(ids.length >= 5);
  });

  await check('class grader: Shuffle Order button sits in the "Who" heading (icon, right-aligned)', async () => {
    const info = await page.$eval('h2 > button.fgh-shuffle', (b) => ({
      text: b.textContent.trim(), icon: !!b.querySelector('span.fgh-icon'), prev: b.previousSibling && b.previousSibling.nodeValue,
      h2display: getComputedStyle(b.parentElement).display, justify: getComputedStyle(b.parentElement).justifyContent,
      color: getComputedStyle(b).color, h2color: getComputedStyle(b.parentElement).color,
      iconMask: getComputedStyle(b.querySelector('.fgh-icon')).maskImage, iconBg: getComputedStyle(b.querySelector('.fgh-icon')).backgroundColor, iconW: b.querySelector('.fgh-icon').getBoundingClientRect().width,
    }));
    assert.equal(info.text, 'Shuffle Order');
    assert.ok(info.icon);
    assert.equal(info.prev, 'Who');
    assert.equal(info.h2display, 'flex');
    assert.equal(info.justify, 'space-between');
    assert.equal(info.color, info.h2color, 'plain text in the heading colour');
    assert.match(info.iconMask, /^url\("data:image\/svg\+xml/);
    assert.equal(info.iconBg, info.color, 'icon drawn in the text colour');
    assert.ok(info.iconW >= 10, 'icon has a size');
  });

  await check('class grader: Next/Prev walk the random order', async () => {
    await page.click('#student-selector button:not([disabled]) .next-label');
    await sleep(100);
    assert.equal(await page.$eval('#student-selector .student-name', (e) => e.textContent), order[0]);
    const shown = await mainScreenIds(page);
    assert.deepEqual(shown, [order[0]], 'main screen shows only the selected student');
    await page.click('#student-selector .next-label');
    await sleep(100);
    assert.equal(await page.$eval('#student-selector .student-name', (e) => e.textContent), order[1]);
    await page.click('#student-selector .prev-label');
    await sleep(100);
    assert.equal(await page.$eval('#student-selector .student-name', (e) => e.textContent), order[0]);
    await page.click('#student-selector .prev-label'); // back to All Students
    await sleep(100);
    assert.equal(await page.$eval('#student-selector .student-name', (e) => e.textContent), 'All Students');
  });

  await check('class grader: Shuffle Order re-randomizes sidebar + main screen and persists', async () => {
    let changed = false; let next;
    for (let i = 0; i < 5 && !changed; i++) {
      await page.click('h2 > button.fgh-shuffle');
      await sleep(100);
      next = await openDropdown(page);
      changed = next.join() !== order.join();
    }
    assert.ok(changed);
    assert.deepEqual(next.slice().sort(), order.slice().sort());
    assert.deepEqual(await mainScreenIds(page), next);
    assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY_USERS), next);
    order = next;
  });

  await check('class grader: order survives a reload', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#poll-col section.poll .response-name', { timeout: 30000 });
    assert.deepEqual(await openDropdown(page), order);
    assert.deepEqual(await mainScreenIds(page), order);
  });

  await check('class grader: progress line under Prev/Next matches the recorded scores', async () => {
    const oa = await (await fetch(`https://127.0.0.1:${PORT}/api/v1/class_grader/classes/104842/outcome-assessments`, { headers: { host: 'forum.minerva.edu' } })).json();
    const students = new Set(classJson.class_users.map((c) => String(c.user.id)));
    const graded = new Set(oa.filter((a) => a.score !== null && students.has(String(a.target_user_id))).map((a) => String(a.target_user_id)));
    const expected = `${graded.size}/${students.size} graded (${Math.round((graded.size / students.size) * 100)}%)`;
    const info = await page.$eval('#student-selector + .fgh-progress', (e) => ({ text: e.textContent, color: getComputedStyle(e).color, h2color: getComputedStyle(e.parentElement.querySelector('h2')).color, size: getComputedStyle(e).fontSize }));
    assert.equal(info.text, expected);
    assert.ok(graded.size > 0 && graded.size < students.size, 'meaningful fixture: ' + expected);
    assert.equal(info.color, info.h2color, 'same plain grey as the heading');
  });

  await check('class grader: comment boxes keep their default size when empty and grow while typing', async () => {
    const info = await page.evaluate(() => {
      const tas = [...document.querySelectorAll('#poll-col textarea')];
      // Forum's CSS height for these boxes, measured on a pristine sibling.
      const c = document.createElement('textarea'); tas[0].parentElement.appendChild(c); const cssHeight = getComputedStyle(c).height; c.remove();
      return { count: tas.length, cssHeight, marked: tas.every((t) => t.dataset.fghAutosize === '1') };
    });
    assert.ok(info.count >= 2);
    assert.ok(info.marked);
    const ta = (await page.$$('#poll-col textarea'))[0];
    await ta.click();
    await ta.evaluate((t) => t.select());
    await page.keyboard.press('Backspace');
    assert.equal(await ta.evaluate((t) => t.value), '');
    assert.equal(await ta.evaluate((t) => getComputedStyle(t).height), info.cssHeight, 'empty box = Forum\'s CSS height');
    const before = await ta.evaluate((t) => t.getBoundingClientRect().height);
    await ta.type(Array.from({ length: 12 }, (_, i) => 'Line ' + i).join('\n'));
    const after = await ta.evaluate((t) => ({ h: t.getBoundingClientRect().height, sh: t.scrollHeight, ch: t.clientHeight }));
    assert.ok(after.h > before + 60, `grew from ${before} to ${after.h}`);
    assert.ok(after.sh <= after.ch + 1, 'no inner scrollbar: content fits');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#poll-col section.poll .response-name', { timeout: 30000 });
    await sleep(300);
    // A pre-filled comment (from the recorded assessments) is sized on appearance.
    const filled = await page.evaluate(() => { const t = [...document.querySelectorAll('#poll-col textarea')].find((x) => x.value.length > 80); return t ? { sh: t.scrollHeight, ch: t.clientHeight, h: t.style.height } : null; });
    assert.ok(filled && filled.h && filled.sh <= filled.ch + 1, 'existing comment fits: ' + JSON.stringify(filled));
  });

  await check('class grader: Video tab shares the order', async () => {
    await page.click('#assessment-type-selector .video-button');
    await page.waitForSelector('#student-selector .current-selection');
    assert.deepEqual(await openDropdown(page), order);
    assert.ok(await page.$('h2 > button.fgh-shuffle'));
  });

  await check('class grader: Workbooks tab (individual workbook) shares the order', async () => {
    await page.click('#assessment-type-selector .workbook-button');
    await page.waitForSelector('#student-selector .current-selection');
    assert.equal(await page.$eval('#student-selector .student-name', (e) => e.textContent), 'Select a student');
    assert.deepEqual(await page.$$eval('#student-selector .dropdown [data-testid]', () => []), []);
    await page.click('#student-selector .current-selection');
    await page.waitForSelector('#student-selector .dropdown [data-testid]');
    const ids = await page.$$eval('#student-selector .dropdown [data-testid]', (els) => els.map((e) => e.dataset.testid).filter((t) => t !== 'all-students'));
    assert.deepEqual(ids, order);
    await page.click('#student-selector .dropdown [data-testid="all-students"]');
    await page.waitForSelector('#student-selector .current-selection');
    assert.ok(await page.$('h2 > button.fgh-shuffle'));
  });

  await check('class grader: Workbooks tab (group workbook) keeps default group order until Shuffle', async () => {
    await page.$$eval('#workbooks-list a', (els) => els[1].click());
    await page.waitForSelector('#student-selector .group-name', { timeout: 15000 });
    const before = await groupDropdown(page);
    assert.ok(before.length >= 2, 'groups: ' + before.join());
    assert.equal(await page.evaluate((k) => localStorage.getItem(k), KEY_GROUPS), null);
    assert.ok(await page.$('h2 > button.fgh-shuffle'), 'button offered for groups');
    let changed = false; let after;
    for (let i = 0; i < 6 && !changed; i++) {
      await page.click('h2 > button.fgh-shuffle');
      await sleep(100);
      after = await groupDropdown(page);
      changed = after.join() !== before.join();
    }
    assert.ok(changed);
    assert.deepEqual(after.slice().sort(), before.slice().sort());
    assert.ok(await page.evaluate((k) => localStorage.getItem(k), KEY_GROUPS));
    // Students untouched by the group shuffle.
    assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY_USERS), order);
  });

  await check('class grader: no page errors', async () => {
    assert.deepEqual(errors, []);
  });

  // ----------------------------------------------------------------- main app
  // The saved main-app pages boot Forum's Backbone/React app against the
  // recorded API responses well enough to exercise our content script.
  const ENTRANCE = 'https://forum.minerva.edu/app/courses/4087/sections/13565/classes/104842';
  await check('class entrance: "Assess Class" reads "Blind Assess Class" and opens the grader with ?blind=true', async () => {
    await page.goto(ENTRANCE, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('button.assess-class', { timeout: 30000 });
    await sleep(1500); // let the app settle / re-render
    assert.equal(await page.$eval('button.assess-class', (b) => b.textContent), 'Blind Assess Class');
    assert.equal(await page.$eval('button.enter-class', (b) => b.textContent), 'Enter Class');
    const [nav] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 }),
      page.click('button.assess-class'),
    ]);
    assert.equal(nav.url(), ENTRANCE + '/review?blind=true');
    assert.equal(page.url(), ENTRANCE + '/review?blind=true');
  });

  await check('assignment entrance: only "Blind Grade Assignment" remains, styled primary', async () => {
    await page.goto('https://forum.minerva.edu/app/assignments/2491635', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.action-view a[href*="blind=true"] > button', { timeout: 30000 });
    await sleep(1500);
    const info = await page.$$eval('.action-view a', (els) => els.map((a) => ({
      text: a.textContent.trim(), hidden: getComputedStyle(a).display === 'none', primary: a.querySelector('button').classList.contains('icon-button-primary'),
      bg: getComputedStyle(a.querySelector('button')).backgroundColor, filter: a.querySelector('.svg-icon') ? getComputedStyle(a.querySelector('.svg-icon')).filter : null,
    })));
    const grade = info.find((i) => i.text === 'Grade Assignment');
    const blind = info.find((i) => i.text === 'Blind Grade Assignment');
    const notes = info.find((i) => i.text === 'View Instructor Notes');
    assert.ok(grade && grade.hidden, 'plain button hidden');
    assert.ok(blind && !blind.hidden && blind.primary, 'blind button visible and primary');
    assert.notEqual(blind.bg, notes.bg, 'blind button no longer looks like the secondary buttons');
    assert.match(blind.filter, /invert/);
  });

  // The main-app bundles are injected at runtime and are not part of the saved
  // pages, so Forum's Backbone grader does not boot here: Prev/Next (which go
  // through Forum's own handler) are covered by test/main-app.test.js. The
  // static page still proves ordering, persistence and Shuffle Order.
  const AKEY = 'fgh:order:assignment:2491635';
  const AGRADER = 'https://forum.minerva.edu/app/assignment-grader/2491635/users/10893?blind=true';
  const gradeeIds = () => page.$$eval('#student-selector .dropdown-list > .list-item.gradee', (els) => els.map((e) => e.dataset.gradeeId));
  let aorder;
  await check('assignment grader (static page): gradees are randomized and persisted; Shuffle Order present', async () => {
    await page.evaluate((k) => localStorage.removeItem(k), AKEY);
    await page.goto(AGRADER, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#student-selector.choose-gradee .dropdown-list .gradee', { timeout: 30000 });
    await sleep(500);
    aorder = await gradeeIds();
    assert.ok(aorder.length >= 5, 'gradees: ' + aorder.length);
    assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), AKEY), aorder);
    assert.notDeepEqual(aorder, aorder.slice().sort(), 'not in Forum\'s order');
    const info = await page.$eval('h2 > button.fgh-shuffle', (b) => ({ prev: b.previousSibling.nodeValue, icon: !!b.querySelector('.fgh-icon'), justify: getComputedStyle(b.parentElement).justifyContent }));
    assert.deepEqual(info, { prev: 'Who', icon: true, justify: 'space-between' });
  });

  await check('assignment grader (static page): Shuffle Order re-randomizes and persists; reload keeps it', async () => {
    let changed = false; let next;
    for (let i = 0; i < 5 && !changed; i++) {
      await page.click('h2 > button.fgh-shuffle');
      await sleep(200);
      next = await gradeeIds();
      changed = next.join() !== aorder.join();
    }
    assert.ok(changed);
    assert.deepEqual(next.slice().sort(), aorder.slice().sort());
    assert.deepEqual(await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), AKEY), next);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#student-selector.choose-gradee .dropdown-list .gradee', { timeout: 30000 });
    await sleep(500);
    assert.deepEqual(await gradeeIds(), next);
  });

  await check('assignment grader (static page): group URL keeps the default order', async () => {
    await page.goto('https://forum.minerva.edu/app/assignment-grader/777/groups/10893?blind=true', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#student-selector.choose-gradee .dropdown-list .gradee', { timeout: 30000 });
    await sleep(500);
    const ids = await gradeeIds();
    assert.deepEqual(ids, ids.slice().sort(), 'Forum\'s order (ascending ids in this capture)');
    assert.equal(await page.evaluate(() => localStorage.getItem('fgh:order:assignment:777')), null);
    assert.ok(await page.$('h2 > button.fgh-shuffle'));
  });

  await check('main app: no page errors', async () => {
    assert.deepEqual(errors, []);
  });

  await check('assignment grader (static page): progress line counts gradees with scores', async () => {
    await page.goto(AGRADER, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.adjacent-submissions + .fgh-progress', { timeout: 30000 });
    const total = (await page.$$('.dropdown-list > .list-item.gradee')).length;
    const scored = (await page.$$('.dropdown-list > .list-item.gradee .num-scores')).length;
    assert.equal(await page.$eval('.adjacent-submissions + .fgh-progress', (e) => e.textContent), `${scored}/${total} graded (${Math.round((scored / total) * 100)}%)`);
    assert.ok(await page.$eval('.adjacent-submissions', (e) => e.classList.contains('mb2') && !e.classList.contains('mb6')));
  });

  const id = await browser.installExtension(EXT);
  const popupUrl = `chrome-extension://${id}/popup/popup.html`;
  await check('popup shows the extension name and version from the manifest', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    const popup = await browser.newPage();
    await popup.goto(popupUrl);
    await popup.waitForFunction(() => document.getElementById('version').textContent !== '…');
    assert.equal(await popup.$eval('#version', (e) => e.textContent), manifest.version);
    assert.equal(await popup.$eval('#name', (e) => e.textContent), manifest.name);
    await popup.close();
  });

  await check('popup setting "Show grading progress" toggles the line in an open grader tab and persists', async () => {
    await page.goto(GRADER, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#student-selector + .fgh-progress', { timeout: 30000 });
    const popup = await browser.newPage();
    await popup.goto(popupUrl);
    await popup.waitForFunction(() => document.getElementById('version').textContent !== '…');
    assert.equal(await popup.$eval('#showProgress', (e) => e.checked), true, 'on by default');
    await popup.click('#showProgress');
    await page.waitForFunction(() => !document.querySelector('.fgh-progress'), { timeout: 5000 });
    await popup.reload();
    await popup.waitForFunction(() => document.getElementById('version').textContent !== '…');
    assert.equal(await popup.$eval('#showProgress', (e) => e.checked), false, 'persisted');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#student-selector', { timeout: 30000 });
    await sleep(1000);
    assert.equal(await page.$('.fgh-progress'), null, 'stays off after reload');
    await popup.click('#showProgress');
    await page.waitForSelector('#student-selector + .fgh-progress', { timeout: 5000 });
    await popup.close();
  });

  await browser.close();
  server.close();
  const failed = results.filter((r) => r[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
