# Releasing to the Chrome Web Store

Releases are automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml):
push a tag `vX.Y.Z` that matches `extension/manifest.json` and the workflow
runs the tests, zips `extension/`, uploads the package to the Web Store,
submits it for review, and attaches the zip to a GitHub Release.

## One-time setup (≈10 minutes)

The Web Store API needs an OAuth client that belongs to the Google account
owning the developer listing, plus a refresh token for it.

1. **Google Cloud project** — open <https://console.cloud.google.com/>, create a
   project (any name), then *APIs & Services → Library* → enable
   **Chrome Web Store API**.
2. **OAuth consent screen** — *APIs & Services → OAuth consent screen*:
   user type *External*, fill in the app name and your email, no scopes needed
   here, and add your own Google account under **Test users** (the app can stay
   in "Testing"; refresh tokens for test users keep working as long as the
   app stays in testing — if Google ever expires it, re-run step 4).
3. **OAuth client** — *APIs & Services → Credentials → Create credentials →
   OAuth client ID*, application type **Desktop app**. Note the *Client ID*
   and *Client secret*.
4. **Refresh token** — in this repo run

   ```sh
   node scripts/cws-auth.js --client-id '<client id>' --client-secret '<client secret>'
   ```

   sign in with the developer-account Google login, accept the
   "Chrome Web Store" permission, and copy the refresh token it prints.
5. **Extension ID** — the 32-letter id shown in the
   [developer dashboard](https://chrome.google.com/webstore/devconsole) for the
   listing (also in its URL).
6. **GitHub secrets** — from the repo directory:

   ```sh
   gh secret set CWS_EXTENSION_ID   --body '<extension id>'
   gh secret set CWS_CLIENT_ID      --body '<client id>'
   gh secret set CWS_CLIENT_SECRET  --body '<client secret>'
   gh secret set CWS_REFRESH_TOKEN  --body '<refresh token>'
   ```

## Cutting a release

```sh
# bump "version" in extension/manifest.json (and package.json), commit, then:
git tag v0.5.5
git push origin main --tags
```

Watch it under *Actions → Release to Chrome Web Store*. The tag must equal the
manifest version (`scripts/check-version.js` refuses otherwise), and the Web
Store only accepts versions higher than the one it already has.

### While a review is pending

The store rejects `publish` while an earlier submission is still under review
(the upload itself replaces the pending draft and is accepted). Either wait
for the review and re-run the failed job, or run the workflow by hand from the
Actions tab with **publish** unticked to upload only.

### Manual fallback

`npm run zip` produces `forum-grading-helper-<version>.zip` for uploading in
the developer dashboard by hand.
