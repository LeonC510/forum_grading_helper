const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { checkVersion } = require('../scripts/check-version.js');

const manifest = path.join(__dirname, '..', 'extension', 'manifest.json');
const version = require(manifest).version;

test('accepts a tag that matches the manifest version', () => {
  assert.equal(checkVersion({ tag: 'v' + version, manifestPath: manifest }), version);
  assert.equal(checkVersion({ tag: 'refs/tags/v' + version, manifestPath: manifest }), version);
});

test('rejects a tag that does not match the manifest version', () => {
  assert.throws(() => checkVersion({ tag: 'v99.99.99', manifestPath: manifest }), /manifest\.json has version .* but the tag is v99\.99\.99/);
});

test('rejects tags that are not vX.Y.Z', () => {
  assert.throws(() => checkVersion({ tag: 'release-1', manifestPath: manifest }), /vX\.Y\.Z/);
});
