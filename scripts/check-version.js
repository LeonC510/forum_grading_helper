// Release guard: the git tag (vX.Y.Z) must match extension/manifest.json.
//   node scripts/check-version.js v0.5.5      (or GITHUB_REF=refs/tags/v0.5.5)
const fs = require('node:fs');
const path = require('node:path');

function checkVersion({ tag, manifestPath }) {
  const short = String(tag).replace(/^refs\/tags\//, '');
  const m = /^v(\d+\.\d+\.\d+)$/.exec(short);
  if (!m) throw new Error(`Tag "${short}" is not of the form vX.Y.Z`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.version !== m[1]) {
    throw new Error(`manifest.json has version ${manifest.version} but the tag is ${short} — bump the manifest (and package.json) before tagging`);
  }
  return manifest.version;
}

if (require.main === module) {
  const tag = process.argv[2] || process.env.GITHUB_REF || '';
  try {
    const v = checkVersion({ tag, manifestPath: path.join(__dirname, '..', 'extension', 'manifest.json') });
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    if (pkg.version !== v) console.warn(`note: package.json says ${pkg.version}, manifest says ${v}`);
    console.log(v);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

module.exports = { checkVersion };
