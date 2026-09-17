// Render extension/icons/logo.svg to the PNG sizes Chrome uses (plus 512 for a store listing).
//   npm run icons
const path = require('node:path');
const puppeteer = require(path.resolve('node_modules/puppeteer-core'));
const fs = require('node:fs');
(async () => {
  const svg = fs.readFileSync(path.resolve('extension/icons/logo.svg'), 'utf8');
  const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  for (const size of [16, 32, 48, 128, 512]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:#000">${svg.replace(/width="128" height="128"/, `width="${size}" height="${size}"`)}</body></html>`);
    await page.screenshot({ path: path.resolve(`extension/icons/icon${size}.png`), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: false });
  }
  await browser.close();
  console.log('rendered', fs.readdirSync(path.resolve('extension/icons')).join(', '));
})();
