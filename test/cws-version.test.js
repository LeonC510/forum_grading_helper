const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isNewer, fetchStoreVersion } = require('../scripts/cws-version.js');

test('isNewer compares dotted versions numerically', () => {
  assert.equal(isNewer('0.5.5', '0.5.4'), true);
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  assert.equal(isNewer('1.0', '0.9.9'), true);
  assert.equal(isNewer('0.5.4', '0.5.4'), false);
  assert.equal(isNewer('0.5.3', '0.5.4'), false);
  assert.equal(isNewer('0.5.5', null), true, 'nothing on the store yet');
});

test('fetchStoreVersion exchanges the refresh token and reads the draft item version', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return { ok: true, json: async () => ({ access_token: 'tok', expires_in: 3599 }) };
    }
    if (url.startsWith('https://www.googleapis.com/chromewebstore/v1.1/items/abc')) {
      return { ok: true, json: async () => ({ kind: 'chromewebstore#item', id: 'abc', crxVersion: '0.5.4', uploadState: 'SUCCESS' }) };
    }
    throw new Error('unexpected ' + url);
  };
  const v = await fetchStoreVersion({ clientId: 'id', clientSecret: 'sec', refreshToken: 'ref', extensionId: 'abc' }, fakeFetch);
  assert.equal(v, '0.5.4');
  assert.equal(calls.length, 2);
  const body = new URLSearchParams(calls[0].init.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'ref');
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok');
  assert.match(calls[1].url, /projection=DRAFT/);
});

test('fetchStoreVersion surfaces token and API errors with context', async () => {
  const bad = async (url) => ({ ok: false, status: 401, json: async () => ({ error: 'invalid_grant' }), text: async () => 'invalid_grant' });
  await assert.rejects(fetchStoreVersion({ clientId: 'i', clientSecret: 's', refreshToken: 'r', extensionId: 'x' }, bad), /token.*401.*invalid_grant/s);
});
