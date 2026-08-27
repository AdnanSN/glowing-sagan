// Change an auth account's login email.
//
// The dashboard has no control for this — Authentication → Users can send a
// recovery link, ban or delete, but not rename. Raw SQL against auth.users is
// the other thing people reach for and it quietly half-works: auth.identities
// keeps its own copy of the address, no trigger syncs it, and the row is left
// pointing at the old mailbox. The Admin API updates both, which is the whole
// reason this script exists.
//
// Usage (PowerShell):
//   $env:SUPABASE_URL='https://xxxx.supabase.co'
//   $env:SUPABASE_SERVICE_ROLE_KEY='eyJ...'
//   node supabase/change-email.mjs husain@nhn.local husain@realdomain.com
//
// Add --sync-roster to also update the matching employees.email (the Team
// page's roster field, which is separate from the login and never synced).
//
// The service_role key bypasses every RLS policy in the project. It is read
// from the environment on purpose so it never lands in this file, in git, or
// in your shell history via a literal. Never put it in a VITE_ variable — that
// would ship it to the browser.

import { createClient } from '@supabase/supabase-js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const args = process.argv.slice(2)
const syncRoster = args.includes('--sync-roster')
const [target, nextEmail] = args.filter(a => !a.startsWith('--'))

function fail(message) {
  console.error(`\n  ✗ ${message}\n`)
  process.exit(1)
}

if (!url || !serviceKey) {
  fail('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (Project Settings → API).')
}
if (!target || !nextEmail) {
  fail('Usage: node supabase/change-email.mjs <current-email|user-uuid> <new-email> [--sync-roster]')
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(nextEmail)) {
  fail(`"${nextEmail}" doesn't look like an email address.`)
}
if (/\.local$/i.test(nextEmail)) {
  fail('.local is a reserved TLD — no mail can be delivered there, so resets would still fail.')
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// listUsers pages at 50 by default; this project has a handful of accounts, so
// one generous page is simpler than looping.
async function findUser(needle) {
  if (UUID_RE.test(needle)) {
    const { data, error } = await admin.auth.admin.getUserById(needle)
    if (error) fail(error.message)
    return data.user
  }
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) fail(error.message)
  return data.users.find(u => u.email?.toLowerCase() === needle.toLowerCase())
}

const user = await findUser(target)
if (!user) fail(`No account found for "${target}".`)

const clash = await findUser(nextEmail)
if (clash && clash.id !== user.id) {
  fail(`${nextEmail} is already used by another account (${clash.id}).`)
}

const alreadySet = user.email?.toLowerCase() === nextEmail.toLowerCase()

console.log(`\n  ${alreadySet ? nextEmail : `${user.email}  →  ${nextEmail}`}`)
console.log(`  user id: ${user.id}`)

if (alreadySet) {
  // Re-running to pick up --sync-roster is a normal thing to want, so passing
  // the same address twice is a no-op rather than an error.
  console.log('  · login email already set — nothing to change')
} else {
  // email_confirm marks the new address confirmed straight away. Without it the
  // account lands in an unconfirmed state and can't sign in while confirmation
  // is switched on — these are hand-managed staff accounts, not self-signups.
  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    email: nextEmail,
    email_confirm: true,
  })
  if (updateError) fail(updateError.message)

  console.log('  ✓ login email updated (auth.users + auth.identities)')
  console.log('  ✓ profiles.email follows via the on_auth_user_email_changed trigger')
}

// The roster row is a different field with a different purpose — someone's
// contact address on the Team page — so it is reported, not silently rewritten.
const { data: employee } = await admin
  .from('employees')
  .select('id, name, email')
  .eq('auth_user_id', user.id)
  .maybeSingle()

if (!employee) {
  console.log('  · no employees row linked to this account')
} else if (employee.email?.toLowerCase() === nextEmail.toLowerCase()) {
  console.log(`  ✓ employees.email for ${employee.name} already matches`)
} else if (syncRoster) {
  const { error: rosterError } = await admin
    .from('employees')
    .update({ email: nextEmail })
    .eq('id', employee.id)
  if (rosterError) fail(`Login email changed, but the roster update failed: ${rosterError.message}`)
  console.log(`  ✓ employees.email for ${employee.name} updated too`)
} else {
  console.log(`  ! employees.email for ${employee.name} still reads ${employee.email || '(empty)'}`)
  console.log('    re-run with --sync-roster to update it, or leave it if the contact address differs')
}

console.log('')
