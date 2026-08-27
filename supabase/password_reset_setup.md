# Password reset — setup

The app ships the whole flow (`/login` → "Forgot password?" → email → `/reset-password`).
Supabase generates the recovery link and sends it; the app never touches mail. What
remains is dashboard configuration, and the link dead-ends if any of it is wrong.

Production origin: **`https://glowing-sagan.vercel.app`**

---

## 0. Blocker first: `.local` addresses can never receive mail

The accounts seeded in `migration_v2_auth.sql` are `nooriya@nhn.local`,
`husain@nhn.local`, `aravinth@nhn.local`, `architect@nhn.local`.

`.local` is a reserved TLD (RFC 6762, multicast DNS). It has no public MX records and
no mail provider can deliver to it. Those accounts cannot receive a reset email no
matter how the rest of this is configured.

Anyone who signed up through the app already used a real address. This only affects
the hand-created accounts.

### Changing an account's login email

**The dashboard cannot do this.** Authentication → Users can send a recovery link,
ban, or delete — there is no edit control for the address, and none is planned.

Raw SQL is the usual workaround and it quietly half-works: `update auth.users set
email = …` leaves `auth.identities` holding its own copy of the old address, because
that table is GoTrue's bookkeeping and no trigger syncs it. Use the Admin API, which
updates both:

```powershell
$env:SUPABASE_URL='https://xxxx.supabase.co'
$env:SUPABASE_SERVICE_ROLE_KEY='eyJ...'     # Project Settings → API
node supabase/change-email.mjs husain@nhn.local husain@realdomain.com
```

`change-email.mjs` in this folder wraps `auth.admin.updateUserById` with the checks
worth having: it refuses `.local` targets, refuses an address another account already
holds, and sets `email_confirm` so the account stays confirmed — an unconfirmed
account can't sign in while email confirmation is on. Add `--sync-roster` to update
the matching `employees.email` in the same run.

The script reads the service key from the environment rather than a literal, so it is
safe to commit. That key bypasses every RLS policy in the project — never put it in a
`VITE_` variable, which would ship it to the browser.

If you'd rather do it in SQL, both tables have to move together:

```sql
update auth.users set email = 'new@example.com', email_change = '' where id = '<uuid>';

update auth.identities
set identity_data = jsonb_set(identity_data, '{email}', to_jsonb('new@example.com'::text))
where user_id = '<uuid>' and provider = 'email';
```

`auth.identities.email` is a generated column derived from `identity_data`, so it
updates itself — don't try to set it directly.

**What follows automatically, and what doesn't:**

| | |
|---|---|
| `profiles.email` | ✅ synced by the `on_auth_user_email_changed` trigger (`migration_v3_self_signup.sql:203`) |
| Role, status, approvals | ✅ untouched — `profiles.id` is the user's UUID, not their address |
| Employee link, tasks, projects | ✅ untouched — `employees.auth_user_id` is the UUID too |
| `employees.email` | ❌ **not** synced — separate roster field, shown on the Team page (`--sync-roster` handles it) |

Nothing else in the app keys off the email string, so changing it is safe once those
two places agree.

---

## 1. Decide who actually sends the mail

Supabase's built-in mailer is capped at a handful of messages per hour **across the
whole project** and is documented as development-only — its mail frequently lands in
spam or is dropped outright. Anything beyond a demo wants custom SMTP.

The catch: the app's hostname is `glowing-sagan.vercel.app`, and that cannot be a
sending identity. Providers verify ownership through DNS records, and `vercel.app`
belongs to Vercel — there is nowhere to add them. **The sending domain and the app
domain are unrelated**; the app can stay on `vercel.app` regardless.

| Option | Needs | Sender looks like | Verdict |
|---|---|---|---|
| **A. Resend** | a domain you control at its registrar | `noreply@send.nhnarchitects.com` | best, if the DNS is reachable |
| **B. Gmail / Workspace SMTP** | a Google account with 2-Step Verification | `studio@nhnarchitects.com` or a `@gmail.com` address | works today, no domain needed |
| **C. Supabase built-in** | nothing | `noreply@mail.app.supabase.io` | last resort — unreliable, hard-capped |

`preview.nhnarchitects.com` is referenced in `src/index.css:5`, so the practice's
domain does exist and someone can reach its DNS — whoever built or hosts the website.
Adding Resend's three records changes nothing about the site itself and takes about
five minutes. Worth one email before settling for B.

---

## 2A. Resend — if a domain becomes available

**Resend → Domains → Add Domain.** Use a subdomain dedicated to sending, e.g.
`send.nhnarchitects.com`, keeping auth mail's reputation separate from staff mail.

Resend then shows the DNS records to add at the registrar:

| Type | Purpose |
|------|---------|
| MX   | bounce/complaint feedback on the sending subdomain |
| TXT  | SPF on the sending subdomain |
| TXT  | DKIM at `resend._domainkey.<subdomain>` |

Copy the values from the dashboard verbatim — the MX target is region-specific, so
anything written here would be wrong for half of projects. The domain must read
**Verified** before Supabase can send. A DMARC record on the root domain (`_dmarc`,
starting at `p=none`) is optional but improves placement at Gmail and Outlook.

Then **Project Settings → Authentication → SMTP Settings → Enable custom SMTP**:

| Field | Value |
|-------|-------|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (literally that word) |
| Password | a Resend API key — **Resend → API Keys**, scope "Sending access" |
| Sender email | `noreply@send.nhnarchitects.com` — must be on the verified domain |
| Sender name | `NHN Architects` |

Resend's free tier is far more than a practice this size sends.

---

## 2B. Gmail / Workspace SMTP — no domain required

Google authenticates the *mailbox*, not a domain, so this works with an account you
already have. Mail is signed by Google's own SPF/DKIM, so it lands properly.

1. On the sending Google account, turn on **2-Step Verification** (App Passwords are
   unavailable without it).
2. **myaccount.google.com → Security → App passwords** → generate one. It's 16
   characters; treat it as a password for that mailbox, because that is exactly what
   it is.
3. **Project Settings → Authentication → SMTP Settings**:

| Field | Value |
|-------|-------|
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | the full Google address |
| Password | the 16-character App Password — **not** the account password |
| Sender email | the same address (Gmail rewrites the From header otherwise) |
| Sender name | `NHN Architects` |

Trade-offs worth knowing: free Gmail allows roughly 500 messages a day (Workspace
~2,000) — irrelevant at this volume; the From address is a person's mailbox rather
than a `noreply@`, which reads as slightly informal for an internal tool; and a
Workspace admin can disable App Passwords org-wide, in which case this option is out.

Use a shared or admin mailbox rather than someone's personal one — otherwise password
resets stop the day that person leaves.

---

## 3. Raise the rate limit

**Authentication → Rate Limits → emails per hour.**

Enabling custom SMTP does not move this on its own — the dashboard limit stays where
it is until you change it, which is the exact constraint custom SMTP exists to remove.
Set it to something realistic for the practice.

---

## 4. Allow the redirect URL

**Authentication → URL Configuration**

- **Site URL** — `https://glowing-sagan.vercel.app`
- **Redirect URLs** — one entry per origin the app runs on:
  - `https://glowing-sagan.vercel.app/reset-password`
  - `http://localhost:5180/reset-password` (the port in `.claude/launch.json`)

`sendPasswordReset()` asks for `${window.location.origin}/reset-password`. Anything
not on this list is ignored: Supabase drops the person on the Site URL with an
`error_description` in the fragment instead, which the reset page reads and reports as
a dead link.

Vercel preview deployments get a fresh hostname each time, so either add a wildcard
(`https://glowing-sagan-*.vercel.app/reset-password`) or accept that resets work on
production and localhost only. If the app later moves to a custom domain, add that
origin too — a missing entry fails silently.

---

## 5. Email template

**Authentication → Emails → Reset Password**

The default body uses `{{ .ConfirmationURL }}`, which is what this flow expects — the
client turns the fragment it comes back with into a session on its own.

`email_templates/reset_password.html` in this folder is a branded replacement in the
app's own palette (flat surfaces, hairline rules, `#0041C2` accent). Paste it into the
template editor and set the subject to `Reset your NHN PM password`. It is plain
table-and-inline-CSS HTML because Gmail, Outlook and Apple Mail each strip a different
half of a stylesheet; keep it that way when editing. It works with any of the sending
options above — Supabase renders the template either way.

The reset page also accepts templates rewritten to use `{{ .TokenHash }}`:

```
{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery
```

Either style works. Nothing in the app needs changing to switch between them.

---

## Notes

- **Test the round trip once** from a real mailbox — request a reset from `/login`,
  follow the link, set a password, sign in with it. On Resend, the Logs tab shows
  delivered/bounced per message; on Gmail, check the sending account's Sent folder.
- A recovery link signs the person in *before* they choose a new password. That is
  Supabase's design — the session is what authorises the change. `/reset-password` is
  therefore reachable regardless of account status, so someone still pending or
  suspended can also fix a forgotten password.
- Links are single-use and expire (1 hour by default, **Authentication → Sessions**).
- Nothing in the flow reveals whether an address has an account: Supabase returns
  success either way and the confirmation copy is deliberately conditional
  ("if it belongs to an account…").
- Custom SMTP moves **all** auth mail to the new sender — signup confirmations too,
  not just password resets.
