# Deploying

The app is a static bundle. `npm run build` emits `dist/`, which is HTML, CSS and JS
with no server process behind it — anything that serves a folder can host it.

## Where things live, and why

| Piece | Where | Cost |
|---|---|---|
| The site | **Cloudflare Pages** | $0 — commercial use allowed, no bandwidth cap |
| Documents, site photos | **Cloudflare R2** | $0 to 10 GB, then ~$0.015/GB. **Egress is always free** |
| Avatars | Supabase Storage | negligible — 512 KB cap each, public and CDN-cached |
| Database, auth | Supabase | $0 — text only |

The split is deliberate. What pushes Supabase off its free plan is **file storage and
egress**, never the data: the free plan allows 500 MB of database and this app's rows are
text, which a practice will not fill in years. Files are the opposite — one drawing is
bigger than a thousand tasks. So files go to Cloudflare, where egress is free forever,
and Supabase is left doing the two things Cloudflare has no answer for: Postgres with
row-level security, and user accounts.

Not on Vercel any more: its free Hobby plan is for personal, non-commercial projects, and
a practice running its own project system on it is neither.

---

## Cloudflare Workers (static assets)

Connect the repository once, then every push deploys.

The dashboard's "Create app" flow produces a **Worker**, not a Pages project — its deploy
step is `npx wrangler deploy`. That is fine, and arguably better: when the R2 signing
endpoint arrives it can live in the same Worker, so the site and its API are one
deployment.

**Build settings**

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Deploy command | `npx wrangler deploy` |

[`wrangler.jsonc`](wrangler.jsonc) is what makes the deploy work. Without it, wrangler
tries to configure the project itself through the Cloudflare Vite plugin, which requires
**Vite 6** — this project is on 5.4, so the deploy fails with *"cannot be automatically
configured"* even though the build succeeded. Naming the settings explicitly skips that
detection entirely.

`not_found_handling: "single-page-application"` in that file is what serves `index.html`
for unknown paths, so refreshing on `/projects/<id>` works. It is the Workers equivalent
of the rewrite in `vercel.json`.

Check a config change before pushing it:

```bash
npx wrangler deploy --dry-run
```

**Do not add a `public/_redirects` file with `/* /index.html 200`.** Workers static assets
parses `_redirects` and already normalises `.html` and `/index` itself, so that rule is
rejected at deploy time as an infinite loop (error 100324). `not_found_handling` above is
the supported way to do it here.

**If you would rather use Pages:** Compute → Pages → Create a project → Connect to Git,
with the same build command and output directory. Pages ignores `wrangler.jsonc`, so it
*would* need a `public/_redirects` containing `/*    /index.html   200` — the opposite of
the rule above. The two platforms want opposite things here, which is worth remembering if
the project ever moves.

**Environment variables** — these are the two that decide whether anyone can log in:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon key>
```

Two ways to get this wrong, and both fail quietly with a site that deploys perfectly and
then shows "⚡ SUPABASE SETUP REQUIRED":

**They must be BUILD variables, not Worker variables.** Vite inlines anything prefixed
`VITE_` into the JavaScript during `npm run build`. By the time the Worker is running,
the bundle is a finished file — it cannot read a runtime binding. So these belong in the
build configuration (Settings → Build), *not* in Variables and Secrets, which is for code
running inside a Worker. A correct value in the wrong section does nothing at all.

**The prefix must be `VITE_`.** Not `NEXT_PUBLIC_`, which is the Next.js convention and is
invisible to Vite. Only `VITE_`-prefixed variables are exposed to the client bundle, and
that filter is a safety feature: it is what stops every environment variable on the build
machine being published in your JavaScript.

Because the values are baked in at build time, changing either one requires a **fresh
deploy** to take effect — editing the variable alone does nothing to the site already
deployed.

The anon key belongs in the bundle; it is public by design, and row-level security is what
protects the data. The service role key must never appear in a `VITE_` variable.

---

## After the first deploy: fix the auth URLs

**Do this immediately, or password resets silently dead-end.**

`sendPasswordReset()` asks Supabase to mail a link back to
`${window.location.origin}/reset-password` ([AuthContext.jsx:136](src/lib/AuthContext.jsx#L136)).
Supabase refuses any redirect target not on its allow-list, so the new hostname has to be
added by hand.

In the Supabase dashboard, **Authentication → URL Configuration**:

- **Site URL** — the Pages production URL, e.g. `https://nhn-pm.pages.dev`
- **Redirect URLs** — add:
  - `https://nhn-pm.pages.dev/reset-password`
  - `http://localhost:5180/reset-password` (the port in `.claude/launch.json`)

Pages gives every preview branch its own hostname, so either add a wildcard
(`https://*.nhn-pm.pages.dev/reset-password`) or accept that resets work on production and
localhost only. If a custom domain is added later, add that too.

See [supabase/password_reset_setup.md](supabase/password_reset_setup.md) for the rest of
the reset flow, including the `.local` addresses on the seeded accounts that can never
receive mail.

---

## Retiring Vercel

Leave the Vercel project running until Pages is verified — logging in, opening a project,
refreshing on a deep link, and completing a password reset. Only then delete it.

`vercel.json` is kept in the repo deliberately. It is inert on Pages and costs nothing,
and it means redeploying to Vercel is possible if something about Pages turns out not to
suit.

---

## Checking it worked

1. Sign in.
2. Open a project, then **refresh the page** — this is what proves `_redirects` is live.
3. Paste a deep link such as `/projects/<id>` into a new tab.
4. Run a password reset end to end. This is the step that catches a missed redirect URL,
   and it is the one most easily forgotten.
