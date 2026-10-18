# Striver's Sheets Tracker

A static site listing every problem from Striver's DSA sheets on takeuforward.org
(A2Z, SDE, Striver's 75, Blind 75, 150 Patterns, 180 Patterns). You sign in with Google, and your
progress and notes are saved **in your own Google Drive**. There is no server and no database.

- **One problem, many sheets.** 532 unique problems back 1,124 sheet entries. Solving a problem in
  any sheet marks it solved in every sheet that contains it.
- **Notes** per problem and per topic (sheet section) are saved as Markdown files in Drive.
- Works signed out too: progress is kept in the browser and merged into Drive the first time you sign in.

## Drive layout

```
Strivers Sheet/
  progress.json                       { version, updatedAt, items: { <problemId>: { solved, revisit?, at } } }
  notes/problem--<problemId>.md
  notes/topic--<sheetId>--<sectionId>.md
```

The app uses the `drive.file` scope. It can only see files it created itself, not the rest of your Drive.
Progress is merged per problem, and the newest change wins. That way two devices or tabs don't overwrite each other.

## Data pipeline

```sh
npm run data:fetch   # download the sheets from takeuforward.org -> scripts/raw/ (gitignored)
npm run data:build   # normalize + dedupe -> src/data/problems.json, src/data/sheets.json
```

- Each sheet's page includes the full syllabus as JSON inside the Next.js RSC payload.
  `scripts/fetch-sheets.mjs` decodes it, so no headless browser is needed.
- The problem id is takeuforward's item slug. It is shared across their sheets (slug and item id map 1:1).
  LeetCode links are not used for deduplication, because TUF points several distinct problems at the same LeetCode link.
- Every practice problem links to takeuforward's own judge (`/practice/dsa/<slug>`). About 168 of them have
  no LeetCode equivalent (patterns, linked-list basics, GFG-style classics), so that is their only judge.
- `scripts/summaries/*.json` holds short summaries written for this site. They are not copied problem
  statements. The build fails if a summary refers to an unknown id. It also fails if a sheet's item count
  doesn't match the total that TUF reports.
- The sheet list lives in `scripts/sheet-list.mjs`.

## Google OAuth setup

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project.
   Then enable the **Google Drive API** (APIs & Services → Library).
2. Configure the **OAuth consent screen**: External, app name, support email. Add the scopes
   `openid`, `email`, `profile` and `.../auth/drive.file`. While the app is in "Testing", add yourself
   as a test user. `drive.file` is a non-sensitive scope, so publishing the app needs no Google verification.
3. Create credentials → **OAuth client ID** → *Web application*. Under **Authorized JavaScript origins**, add:
   - `http://localhost:4321`
   - `https://<your-user>.github.io`

   No redirect URIs are needed, because the app uses the token popup flow.
4. Local: copy `.env.example` to `.env` and set `PUBLIC_GOOGLE_CLIENT_ID`.
5. GitHub: go to repo **Settings → Secrets and variables → Actions → Variables** and add `PUBLIC_GOOGLE_CLIENT_ID`.
   The client ID is public by design, so a variable is enough; it doesn't need to be a secret.

## Develop / deploy

```sh
npm install
npm run dev          # http://localhost:4321
npm run check        # type check
npm run build
```

Deploy: push to `main` with **Settings → Pages → Source: GitHub Actions** enabled.
`.github/workflows/deploy.yml` builds with the right `SITE` and `BASE_PATH` for `https://<user>.github.io/<repo>/`.
