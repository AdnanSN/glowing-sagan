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

## Cloudflare Pages

Connect the repository once, then every push deploys.

**Build settings**

| Setting | Value |
|---|---|
| Framework preset | None (or Vite) |
| Build command | `npm run build` |
| Build output directory | `dist` |

**Environment variables** — set these under Settings → Environment variables, for both
Production and Preview:

```
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<the anon key>
```

Vite inlines `VITE_` variables **at build time**, not at run time, so changing either one
means triggering a fresh deploy. The anon key belongs in the bundle — it is public by
design, and row-level security is what actually protects the data. The service role key
must never appear in a `VITE_` variable.

Deep links are handled by [`public/_redirects`](public/_redirects), which is the Pages
equivalent of the rewrite in `vercel.json`. Without it, refreshing on `/projects/<id>`
returns a 404.

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
