// Which version does the Chrome Web Store currently hold for this extension?
// Used by the deploy workflow: a merge deploys only if the manifest is newer
// (the store rejects anything else). Prints the version, or "none".
//   EXTENSION_ID/CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN env vars, as the upload CLI uses.

function isNewer(candidate, current) {
  if (!current) return true;
  const a = String(candidate).split('.').map(Number);
  const b = String(current).split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function fetchStoreVersion({ clientId, clientSecret, refreshToken, extensionId }, fetchImpl = fetch) {
  const tokenRes = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
  });
  if (!tokenRes.ok) throw new Error(`Could not get an access token (HTTP ${tokenRes.status}): ${await tokenRes.text()}`);
  const { access_token: token } = await tokenRes.json();

  const itemRes = await fetchImpl(`https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}?projection=DRAFT`, {
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
  });
  if (!itemRes.ok) throw new Error(`Could not read the store item (HTTP ${itemRes.status}): ${await itemRes.text()}`);
  const item = await itemRes.json();
  return item.crxVersion || null;
}

if (require.main === module) {
  const env = process.env;
  fetchStoreVersion({ clientId: env.CLIENT_ID, clientSecret: env.CLIENT_SECRET, refreshToken: env.REFRESH_TOKEN, extensionId: env.EXTENSION_ID })
    .then((v) => console.log(v || 'none'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = { isNewer, fetchStoreVersion };
