# Deploying to Cloudflare — the steps only an account holder can do

Everything in this file needs your Cloudflare account. Nothing here can be
done from the repo, which is why it is a checklist rather than a script.

Work through it in order; later steps depend on ids produced by earlier ones.
Each step says what to paste where, and what "it worked" looks like.

**Never paste a secret into a chat, a commit, a PR or a screenshot.** Secrets
go in via `wrangler secret put`, which reads from your terminal and stores the
value on Cloudflare. They are never written to a file in this repo.

---

## 0. Prerequisites

```bash
cd worker
npx wrangler login          # opens a browser, authorises this machine
npx wrangler whoami         # should print your account name and id
```

If `whoami` prints an account, you are ready. Note the **account id** — you
will not need to paste it anywhere, but it confirms which account the rest of
these commands act on.

**Cost check before you start.** Everything below runs on free tiers:

| | Free allowance | What binds first here |
|---|---|---|
| Workers | 100,000 requests/day | Request count |
| D1 storage | 500 MB per database | ~4M answer rows; the retention cron keeps it bounded |
| D1 reads | 5M rows/day | Comfortable |
| D1 writes | 100,000 rows/day | Answer recording; the retention cron is capped at 25,000/day so it can never eat the budget |
| Pages | unlimited requests | — |

Workers Paid is $5/month and raises D1 writes to 50M/day. You do not need it
to launch. The one thing it buys that matters is headroom on write volume once
you have a few hundred daily users.

---

## 1. Create the D1 database

```bash
cd worker
npx wrangler d1 create necprep
```

It prints a block like:

```
[[d1_databases]]
binding = "DB"
database_name = "necprep"
database_id = "a1b2c3d4-...."
```

**Copy the `database_id`.** Paste it into `worker/wrangler.toml` in **two**
places, replacing `REPLACE_WITH_D1_DATABASE_ID`:

- line ~25, under the top-level `[[d1_databases]]`
- line ~85, under `[[env.production.d1_databases]]`

It is the same id in both. The placeholder is deliberate: a wrong-but-plausible
id would deploy against the wrong database, so it must fail loudly until a
human pastes the real one.

> The database id is **not** a secret. It identifies a database that still
> requires your API token to touch. It is fine in the repo, and it has to be —
> `wrangler` reads it from this file at deploy time.

**Verify:**
```bash
npx wrangler d1 list        # necprep should appear
```

---

## 2. Apply the migrations to the real database

```bash
cd worker
npx wrangler d1 migrations apply necprep --remote
```

This runs `migrations/0001` through `0009` in order. It will list them and ask
for confirmation.

**Verify** — this should print 10 chapters and 60 sub-chapters:
```bash
npx wrangler d1 execute necprep --remote \
  --command "SELECT (SELECT COUNT(*) FROM chapters) AS chapters, (SELECT COUNT(*) FROM subchapters) AS subchapters"
```

If `chapters` is 0, migration `0007_reference_data.sql` did not run — stop and
say so, rather than continuing.

---

## 3. Set the secrets

Two are required. The third group is optional.

### 3a. `CONTENT_PERMUTATION_SECRET` — required

This seeds the option shuffle the content endpoints serve. It must be at least
32 characters and must not be guessable: with it, the shuffle applied to any
(user, question) can be reproduced offline and joined against the chapter JSON
that is public in this repo's git history.

Generate one and pipe it straight in, so it never appears in your shell
history or on screen:

```bash
cd worker
openssl rand -base64 48 | npx wrangler secret put CONTENT_PERMUTATION_SECRET
openssl rand -base64 48 | npx wrangler secret put CONTENT_PERMUTATION_SECRET --env production
```

Run it for **both** environments — they are separate secret stores. Different
values in each is fine and slightly better.

> If you ever need to rotate this: it is safe. Rotating reshuffles every
> browse order and nothing else breaks.

### 3b. `APP_ORIGIN` — required, but it is a var, not a secret

You edit this in `worker/wrangler.toml`, not via `wrangler secret`. It drives
CORS and the OAuth redirect, so it must be the exact origin your frontend is
served from, **with no trailing slash**:

- `[vars]` → `APP_ORIGIN` — leave as `http://localhost:5173` for local dev
- `[env.production.vars]` → `APP_ORIGIN` — replace
  `REPLACE_WITH_FRONTEND_ORIGIN` with the real one, e.g.
  `https://necprep.pages.dev` or your custom domain

You will know this value after step 5, so it is fine to come back to it.

### 3c. Google sign-in — optional, skip to step 4 if you do not want it

Google is **not required to launch.** Guest and email/password both work
without it. Everything below is additive.

#### What you do NOT need

These are the three things people assume block them, and none of them apply:

- **App verification / review.** The code requests `openid email profile`
  (`worker/src/handlers/auth.ts:384`). All three are *non-sensitive* scopes, so
  Google requires no review, no demo video and no security assessment.
- **Billing.** No card, no paid project.
- **A different auth provider.** Auth0 and the like ship "developer keys" for
  Google that are documented as testing-only — shared and rate-limited. Going
  to production through them means creating your own Google OAuth client
  anyway, i.e. doing exactly this section plus running a second auth system.

#### Click by click

**1. Create a project.** [console.cloud.google.com](https://console.cloud.google.com)
→ project dropdown in the top bar → **New project** → name it `necprep` →
**Create**. Wait for the notification, then make sure that project is selected
in the top bar. *Most confusion here comes from configuring one project while
a different one is selected.*

**2. OAuth consent screen.** Left menu → **APIs & Services** → **OAuth consent
screen**.

- User type: **External** → **Create**.
  (*Internal* is only offered on Google Workspace accounts and would restrict
  sign-in to your own organisation.)
- **App name**: `NECPrep`
- **User support email**: your address
- **Developer contact email**: your address
- Leave the App domain fields **empty for now** — see "Testing vs Published"
  below.
- **Save and continue**.

**3. Scopes screen** → change nothing → **Save and continue**. `openid`,
`email` and `profile` are granted by default and are not listed here; adding
anything from this page is what turns a no-review app into one that needs
review.

**4. Test users screen** → **Add users** → add your own Gmail address →
**Save and continue**. This matters: while the app is in Testing, *only* the
addresses listed here can sign in.

**5. Create the credential.** **APIs & Services** → **Credentials** →
**Create credentials** → **OAuth client ID**.

- Application type: **Web application**
- Name: `necprep-api`
- **Authorised JavaScript origins**: leave **empty**. This is a server-side
  flow; the browser never holds the token.
- **Authorised redirect URIs** → **Add URI** → paste exactly:
  ```
  https://necprep-api.waglesameer5.workers.dev/api/auth/google/callback
  ```
- **Create**

A dialog shows the **Client ID** and **Client secret**. Keep it open, or
download the JSON — the secret can be re-shown later, but it is easier not to
have to.

**6. Hand them over.** Either run these three and paste each value when
prompted:

```bash
cd worker
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
npx wrangler secret put GOOGLE_REDIRECT_URI --env production
```

`GOOGLE_REDIRECT_URI` is the full callback URL from step 5, **character for
character** — a trailing slash or `http` instead of `https` is a mismatch.

The client id is not really a secret, but all three are stored the same way
because `loadConfig` requires all three or none: a half-configured OAuth app
fails at Google with `redirect_uri_mismatch`, which is a confusing place to
debug a missing environment variable.

#### Testing vs Published

Leaving the app in **Testing** is a legitimate place to stop. Up to 100 listed
test users can sign in, no App-domain fields are required, and nothing expires
for a non-sensitive-scope app.

**Publishing** removes the test-user list so anyone can sign in, and Google
then requires an **Application homepage** and a **Privacy policy URL** on the
consent screen. The platform has neither page yet. Ask and I will build
`/privacy` and `/terms` — a public exam platform needs them regardless — and
then publishing is two clicks.

#### If it goes wrong

| Message | Cause |
|---|---|
| `Error 400: redirect_uri_mismatch` | The redirect URI in the console differs from `GOOGLE_REDIRECT_URI`. Compare them character for character, including `https` and no trailing slash. |
| `Error 403: access_denied` + "has not completed the Google verification process" | The app is in Testing and the signing-in address is not in the test-user list. Add it in step 4. |
| "This app isn't verified" warning screen | Expected in Testing. Click **Advanced** → **Go to NECPrep (unsafe)**. It disappears once published. |
| Google routes return 404 | Fewer than three secrets are set. That is deliberate — see `loadConfig`. |
| `invalid_client` | Client id or secret mistyped, or they belong to a different project than the redirect URI. |

Confirm it is live:
```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  "https://necprep-api.waglesameer5.workers.dev/api/auth/google/start"
```
A `302` to `accounts.google.com` means configured. A `404` means the secrets
are not all set.

**Verify:**
```bash
npx wrangler secret list --env production
```

---

## 4. Deploy the Worker

```bash
cd worker
npx wrangler deploy --env production
```

Expected output includes:

- `Your Worker has access to the following bindings:` listing `env.DB`,
  `env.ENVIRONMENT`, `env.APP_ORIGIN`, `env.ANSWER_RETENTION_DAYS`
- a **Schedules** section listing the three crons — `10 2 * * *`,
  `40 2 * * *`, `5 * * * *`
- a URL like `https://necprep-api.<your-subdomain>.workers.dev`

**Copy that URL.** It is `VITE_API_BASE_URL` in step 5.

If the Schedules section is missing, the `scheduled` handler did not register —
tell me, do not work around it.

**Verify the API is alive:**
```bash
curl -s https://necprep-api.<your-subdomain>.workers.dev/api/content/chapters | head -c 200
```

A JSON array of chapters means the Worker, D1 and the reference data are all
wired. A 500 almost always means `APP_ORIGIN` or
`CONTENT_PERMUTATION_SECRET` is missing — the config fails closed on purpose.

---

## 5. Load the question bank into the real database

The bank is in git, so this is an import rather than a transfer. Three
commands:

```bash
cd worker
npm run db:apply:local        # migrations into .local/necprep.sqlite
npm run db:seed:local         # 2,290 questions, 1,523 classified
npm run db:export:remote      # writes .local/remote/*.sql
```

The last one prints nine numbered files. Replay them **in order**:

```bash
cd worker
for f in .local/remote/*.sql; do
  npx wrangler d1 execute necprep --remote --file "$f" -y || break
done
```

The `|| break` matters: `question_options` and `question_answer_keys`
reference `questions`, so a later file needs rows an earlier one inserted. If
one fails, stop and fix it rather than continuing.

**Verify** — should print 2290, 2184 and 1523:
```bash
npx wrangler d1 execute necprep --remote --command \
  "SELECT COUNT(*) AS questions,
          SUM(status = 'published') AS published,
          SUM(subchapter_id IS NOT NULL) AS classified
     FROM questions"
```

> **Why a script and not `wrangler d1 export`.** `--local` exports the
> database `wrangler dev` uses, which is *not* the one `db:seed:local` writes,
> and it emits CREATE TABLE statements that fail against an already-migrated
> database. Both failures are quiet. `db/seed/export-content-sql.mjs` reads the
> file the seed actually wrote and emits data only.
>
> **It is safe to re-run**, both the export and the replay: every statement is
> `INSERT OR REPLACE` and question ids are content hashes, so after a bank
> update only changed rows change. Verified by replaying the full set twice
> into a fresh migrated database — identical counts, zero foreign-key
> violations.
>
> **It only touches content.** Questions, options and answer keys. No users,
> sessions, attempts or progress: content is derived from files in git and is
> safe to replace wholesale, user data is not.

---

## 6. Deploy the frontend

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name necprep
```

First run asks to create the project; accept. It prints a URL like
`https://necprep.pages.dev`.

### The API base URL

Vite inlines `VITE_API_BASE_URL` at **build** time. We deploy a bundle that is
already built, so Cloudflare never runs the build and a Pages dashboard
variable would have no effect — **the value has to be present on the machine
that runs `npm run build`.**

Create `frontend/.env.production` with the Worker URL from step 4, no trailing
slash:

```bash
cd frontend
printf 'VITE_API_BASE_URL=https://necprep-api.<your-subdomain>.workers.dev\n' > .env.production
npm run build
npx wrangler pages deploy dist --project-name necprep --branch main
```

That file is **gitignored**. The value is public — a `VITE_` variable is
compiled into the bundle every visitor downloads — but the stage guard treats
every `.env` file as a secret file and that rule is worth keeping, so the file
lives on the build machine rather than in the repo. Anyone setting up a new
build environment runs the `printf` above once.

**Leaving it out is not an error.** The build succeeds and produces the
local-only app: questions from `public/data/*.json`, progress in
localStorage, no sign-in. That is a supported mode. It is also easy to ship by
accident, so confirm the URL is in the bundle before you call it done:

```bash
grep -rl "workers.dev" dist/assets/ | head -1    # should print one .js file
```

Now go back to **step 3b** and set `APP_ORIGIN` in
`[env.production.vars]` to this Pages URL, then redeploy the Worker:

```bash
cd worker
npx wrangler deploy --env production
```

The two have to agree: the Worker's CORS policy names the frontend origin, and
the frontend names the Worker URL.

---

## 7. Confirm the crons are actually scheduled

```bash
cd worker
npx wrangler deployments list --env production | head -20
```

And in the dashboard: **Workers & Pages** → `necprep-api` → **Settings** →
**Trigger Events**. Three cron triggers should be listed.

To test one immediately rather than waiting for 02:10 UTC:

```bash
cd worker
npx wrangler dev --test-scheduled --env production
# then, in another terminal:
curl "http://localhost:8787/__scheduled?cron=5+*+*+*+*"
```

That fires the leaderboard job. It logs one JSON line with `ok: true`, the
query count and what it wrote. An unknown cron string throws on purpose.

---

## What you do NOT need to do

- **No Hyperdrive.** D1 is single-threaded per database and serialises writes;
  there is no connection pool to put in front of it.
- **No R2 bucket**, unless you later want long-term answer archival. The
  retention job deletes rather than archives, which is what actually bounds
  the database. See `worker/src/jobs/retention.ts` for why.
- **No KV namespace.** Sessions, rate limits and idempotency keys are all D1
  tables, deliberately — one store, one set of transactional guarantees.
- **No Durable Objects.** `wrangler.toml` has an empty migration tag so
  `deploy` does not warn; nothing uses them.
- **No Workers Paid**, to launch.

---

## If something fails

| Symptom | Cause |
|---|---|
| Every request 500s | `APP_ORIGIN` or `CONTENT_PERMUTATION_SECRET` missing. Config fails closed by design. |
| `Server is not configured` in logs | Same, and the log names the variable. |
| CORS error in the browser | `APP_ORIGIN` does not exactly match the frontend origin. Check the scheme and the trailing slash. |
| `redirect_uri_mismatch` at Google | `GOOGLE_REDIRECT_URI` differs from the console value. |
| `/api/content/chapters` returns `[]` | Migration 0007 did not run, or step 5 was skipped. |
| Google routes 404 | Fewer than three Google secrets set. That is the intended behaviour. |
| No Schedules section on deploy | The `scheduled` export is missing. Report it. |

Worker logs:
```bash
cd worker
npx wrangler tail --env production
```

Observability is already enabled in `wrangler.toml`, so logs are retained in
the dashboard as well.
