#!/usr/bin/env node
// One-time helper: obtain the Chrome Web Store API refresh token for CI.
//
//   node scripts/cws-auth.js --client-id <id> --client-secret <secret> [--no-open]
//
// Opens Google's consent screen (loopback flow — Google no longer allows the
// copy-paste flow), receives the code on http://127.0.0.1:8484, exchanges it
// and prints the refresh token. See docs/RELEASING.md.
const http = require('node:http');
const { execFile } = require('node:child_process');

const argv = process.argv.slice(2);
const args = Object.fromEntries(argv.map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : [])).filter((x) => x.length));
const noOpen = argv.includes('--no-open');
const clientId = args['client-id'] || process.env.CLIENT_ID;
const clientSecret = args['client-secret'] || process.env.CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('usage: node scripts/cws-auth.js --client-id <id> --client-secret <secret>');
  process.exit(1);
}

const PORT = 8484;
const redirectUri = `http://127.0.0.1:${PORT}`;
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/chromewebstore',
  access_type: 'offline',
  prompt: 'consent',
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) { res.writeHead(400); res.end('No code in the callback: ' + (url.searchParams.get('error') || '')); return; }
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tokens = await r.json();
    if (!tokens.refresh_token) throw new Error('No refresh_token in the response: ' + JSON.stringify(tokens));
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Done — you can close this tab and go back to the terminal.');
    console.log('\nRefresh token (store it as the CWS_REFRESH_TOKEN secret):\n');
    console.log(tokens.refresh_token + '\n');
    console.log('  gh secret set CWS_REFRESH_TOKEN --body "<paste it>"\n');
  } catch (e) {
    res.writeHead(500); res.end(String(e));
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Sign in with the Google account that owns the Chrome Web Store developer account.');
  console.log('If the browser does not open, visit:\n\n' + authUrl + '\n');
  if (!noOpen) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [authUrl], () => {});
});
