# Running the whole thing locally

You can test everything on your own machine, including the real Google sign-in
flow. There is no "dev mode" branch in the code — the local Worker runs the
same handlers, against the same schema, reading secrets the same way.

Testing OAuth by deploying to production and clicking around is the slow and
dangerous way to do it. This is the fast one.

---

## One-time setup

```bash
cd worker
cp .dev.vars.example .dev.vars     # local secrets; gitignored
npm run dev:setup                  # migrations + 2,290 questions
```

`dev:setup` takes a couple of minutes and does five things:

| Step | What it builds |
|---|---|
| `db:apply:local` | migrations into `.local/necprep.sqlite` |
| `db:seed:local` | the question bank, classified into sub-chapters |
| `db:export:remote` | `.local/remote/*.sql` |
| `d1:migrate:local` | migrations into the **wrangler** database |
| `d1:load:local` | the same content into the **wrangler** database |

### Why two databases

This trips people up, so it is worth a sentence:

```
.local/necprep.sqlite                         tests, db:smoke, db:verify
.wrangler/state/v3/d1/miniflare-<hash>.sqlite  wrangler dev, --local
```

`npm run db:seed:local` fills the **first**. `wrangler dev` reads the
**second**, and never looks at the first. So it is entirely possible to run
`npm run db:check`, see 2,290 questions pass, start `wrangler dev`, and get an
empty API. `d1:load:local` is what bridges them, and `dev:setup` runs both.

---

## Every day

Two terminals.

```bash
# terminal 1 — the API on http://localhost:8787
cd worker && npm run dev
```

```bash
# terminal 2 — the app on http://localhost:5173
cd frontend
echo "VITE_API_BASE_URL=http://localhost:8787" > .env.local   # once
npm run dev
```

`.env.local` is gitignored. Delete it to run the app against static JSON with
no backend at all — a supported mode, and worth checking occasionally, because
it is what a visitor gets if a build ever ships without the variable.

**Check the API is awake:**

```bash
curl -s http://localhost:8787/api/content/chapters | head -c 120
```

Ten chapters with real counts means the Worker, the local D1 and the seed all
line up.

---

## Testing Google sign-in locally

Google permits `http://localhost` redirect URIs as an explicit exception to
its HTTPS rule. That is what makes this possible.

**1. Add a second redirect URI to the SAME OAuth client** —
[Clients](https://console.cloud.google.com/auth/clients) → your client → add,
alongside the production one:

```
http://localhost:8787/api/auth/google/callback
```

One client with two URIs, not two clients. A second client is a second secret
to rotate and a second consent screen to keep in step.

**2. Fill in all three values in `worker/.dev.vars`:**

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-...
GOOGLE_REDIRECT_URI=http://localhost:8787/api/auth/google/callback
```

**All three or none.** With one or two set, the Google routes return
`500 Google sign-in is misconfigured` — on purpose, because a half-configured
OAuth app otherwise fails much later, at Google, as
`redirect_uri_mismatch`. Everything else keeps working; see below.

**3. Restart `npm run dev`.** Wrangler reads `.dev.vars` at startup, not per
request.

**4. Check:**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  http://localhost:8787/api/auth/google/start
```

| | |
|---|---|
| `302` | configured — it is redirecting to `accounts.google.com` |
| `404` | none of the three set; the feature is simply off |
| `500` | one or two set. Fix `.dev.vars` and restart |

Then click Continue with Google in the app at `http://localhost:5173`.

Expect an **"This app isn't verified"** warning while the consent screen is in
Testing: Advanced → Go to NECPrep. And your own address must be on the
**Test users** list, or Google refuses with a message about verification that
has nothing to do with the real cause.

---

## A misconfigured optional feature cannot break a required one

`loadConfig` runs in the `/api/*` middleware, once per request, so anything it
throws for takes down every endpoint. That is correct for `APP_ORIGIN` and
`CONTENT_PERMUTATION_SECRET` — the first is the CORS policy and the second
protects the option permutation, and neither has a safe default.

It is not correct for Google. It used to throw there too, which meant one
missing secret 500'd the chapter list, guest sign-in and paper submission,
each reporting `Google OAuth needs GOOGLE_CLIENT_ID...` — a baffling thing to
read when you asked for a list of chapters. Now the misconfiguration is
recorded and surfaces only on the three Google routes.

`src/__tests__/config.test.ts` holds that line: what must still fail hard, and
what must not.

---

## Secrets, local and deployed

They are separate stores and neither can see the other.

| | Local | Deployed |
|---|---|---|
| Where | `worker/.dev.vars` | Cloudflare |
| Set by | editing the file | `wrangler secret put NAME --env production` |
| Visible after | yes, it is a file you own | **no, never again** |

`wrangler secret put` reads the value from your terminal and stores it on
Cloudflare. It does not read `.dev.vars`, and `.dev.vars` is not uploaded.

**A secret never belongs in a file in this repository.** `.gitignore` covers
`.dev.vars`, `*secret*`, `*.pem` and `*.key` as a backstop, but the backstop
is not the rule — the rule is that it goes from the console to
`wrangler secret put` and nowhere else. If one does land in a file, or in a
chat, or in a screenshot, it is burned: add a new secret in the console, set
it, then **delete the old one**. Deleting the file changes nothing on its own.

---

## Resetting

```bash
cd worker
rm -rf .wrangler .local     # both local databases
npm run dev:setup           # rebuild from migrations + the question bank
```

Nothing in either database is authored by hand, so this is always safe.
