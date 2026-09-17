# Releasing to the Chrome Web Store

Deployment is automated by [`.github/workflows/release.yml`](../.github/workflows/release.yml):
when a pull request is merged into `main`, the workflow checks out the merge
commit, runs the tests, asks the Web Store which version it currently holds
(`scripts/cws-version.js`) and, if `extension/manifest.json` is newer, zips
`extension/`, uploads the package and submits it for review. The zip is kept
as a build artifact on the run. Direct pushes to `main` only run the tests,
and pull requests from forks cannot deploy (GitHub withholds the secrets).

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

1. In a pull request, bump `version` in `extension/manifest.json` (and
   `package.json`) alongside the changes — the Web Store only accepts a
   version higher than the one it already has.
2. Merge it. Watch *Actions → Deploy to Chrome Web Store*: the run logs
   `store has X, manifest is Y: deploying`, uploads and submits for review.

If the manifest is not newer than the store's version, the run ends with a
notice and nothing is uploaded.

### Manual runs / while a review is pending

The store rejects `publish` while an earlier submission is still under review
(the upload itself replaces the pending draft and is accepted). Either wait
for the review and re-run the failed job, or run the workflow by hand from the
Actions tab — a manual run always uploads the current `main`, and **publish**
can be unticked to upload only.

### Manual fallback

`npm run zip` produces `forum-grading-helper-<version>.zip` for uploading in
the developer dashboard by hand.
