-- ============================================================
-- MIGRATION v3 — Self-service sign-up + admin-controlled access
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- What changes vs v2:
--
--   * New `profiles` table — one row per auth user, created
--     AUTOMATICALLY by a trigger the instant somebody signs up.
--     Employees can now create their own accounts; nobody has to
--     add them by hand in the Supabase dashboard.
--
--   * Access is now a pair: (role, status). A brand-new sign-up
--     lands as role='viewer', status='pending' and can see
--     NOTHING until an owner approves it. This is the important
--     part — in v2 every authenticated user could read everything.
--
--   * Roles become a 4-tier ladder instead of admin/member:
--       admin   (100)  full control + manages who gets access
--       manager (70)   projects, milestones, tasks, documents
--       member  (40)   tasks, documents, comments
--       viewer  (10)   read-only
--
--   * RLS reads role+status from `profiles` through SECURITY
--     DEFINER helpers (so no policy recursion) instead of from
--     the JWT. Granting or revoking access therefore takes effect
--     on the user's very next request — no token refresh, no
--     sign-out, no dashboard visit.
--
-- Existing users are migrated in section 9: today's admins stay
-- admins, everyone else becomes 'viewer', which is exactly the
-- read-only access they have right now. Promote them from the
-- in-app Access page afterwards.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. PROFILES — one row per auth user
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  role         text        not null default 'viewer',
  status       text        not null default 'pending',
  employee_id  uuid        references public.employees(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid        references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- Constraints added separately so re-running the file never errors.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles add constraint profiles_role_check
      check (role in ('admin', 'manager', 'member', 'viewer'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'profiles_status_check') then
    alter table public.profiles add constraint profiles_status_check
      check (status in ('pending', 'approved', 'suspended', 'rejected'));
  end if;
end$$;

create index if not exists profiles_status_idx   on public.profiles (status);
create index if not exists profiles_employee_idx on public.profiles (employee_id);

-- An employee record can be claimed by at most one login.
create unique index if not exists profiles_employee_unique
  on public.profiles (employee_id) where employee_id is not null;


-- ─────────────────────────────────────────────────────────────
-- 2. Role helpers
--    All SECURITY DEFINER so they can read `profiles` without
--    tripping the RLS policies that are themselves defined in
--    terms of these functions.
-- ─────────────────────────────────────────────────────────────
create or replace function public.role_rank(r text)
returns int
language sql
immutable
as $$
  select case r
    when 'admin'   then 100
    when 'manager' then 70
    when 'member'  then 40
    when 'viewer'  then 10
    else 0
  end;
$$;

-- Returns 'none' for anyone who is not an approved user, so every
-- policy below fails closed for pending / suspended / rejected.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role from public.profiles p
      where p.id = auth.uid() and p.status = 'approved'),
    'none'
  );
$$;

create or replace function public.has_min_role(min_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.role_rank(public.current_user_role()) >= public.role_rank(min_role);
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.role_rank(public.current_user_role()) > 0;
$$;


-- ─────────────────────────────────────────────────────────────
-- 3. Auto-create a profile on sign-up
-- ─────────────────────────────────────────────────────────────
create or replace function public.create_profile_for(
  p_user_id   uuid,
  p_email     text,
  p_full_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bootstrap boolean;
begin
  -- On a brand-new install the very first account becomes the owner,
  -- otherwise there would be nobody able to approve anyone. Once an
  -- approved admin exists, every later sign-up lands in the queue.
  select not exists (
    select 1 from public.profiles where role = 'admin' and status = 'approved'
  ) into v_bootstrap;

  insert into public.profiles (id, email, full_name, role, status, approved_at)
  values (
    p_user_id,
    p_email,
    nullif(btrim(coalesce(p_full_name, '')), ''),
    case when v_bootstrap then 'admin'    else 'viewer'  end,
    case when v_bootstrap then 'approved' else 'pending' end,
    case when v_bootstrap then now() end
  )
  on conflict (id) do nothing;
end$$;

-- Not for direct calling — only the definer-owned trigger/RPC below.
revoke all on function public.create_profile_for(uuid, text, text)
  from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_profile_for(
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name'
  );
  return new;
end$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- Keep profiles.email in step if the login email is ever changed.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Transaction-local flag so guard_profile_changes() lets this one
  -- write through — the user themselves is not an admin.
  perform set_config('app.syncing_email', 'on', true);
  update public.profiles set email = new.email where id = new.id;
  perform set_config('app.syncing_email', 'off', true);
  return new;
end$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (new.email is distinct from old.email)
  execute function public.handle_user_email_change();


-- Safety net the app calls if a signed-in user somehow has no
-- profile row (trigger was missing when they registered, row was
-- deleted by hand, …). Always creates a *pending* profile.
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email     text;
  v_full_name text;
  v_profile   public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select u.email, u.raw_user_meta_data ->> 'full_name'
    into v_email, v_full_name
    from auth.users u where u.id = auth.uid();

  perform public.create_profile_for(auth.uid(), v_email, v_full_name);

  select * into v_profile from public.profiles where id = auth.uid();
  return v_profile;
end$$;

grant execute on function public.ensure_profile() to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. Nobody escalates themselves
--    Users may edit their own display name and nothing else.
--    Admins may edit anything, except locking out the last admin.
-- ─────────────────────────────────────────────────────────────
create or replace function public.guard_profile_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_count int;
begin
  if public.is_admin() then
    if old.role = 'admin' and old.status = 'approved'
       and (new.role <> 'admin' or new.status <> 'approved') then
      select count(*) into v_admin_count
        from public.profiles where role = 'admin' and status = 'approved';
      if v_admin_count <= 1 then
        raise exception 'Cannot demote or suspend the last remaining admin';
      end if;
    end if;
    return new;
  end if;

  -- Everyone else may change their display name and nothing else.
  if new.role         is distinct from old.role
  or new.status       is distinct from old.status
  or new.employee_id  is distinct from old.employee_id
  or new.approved_by  is distinct from old.approved_by
  or new.approved_at  is distinct from old.approved_at
  or new.requested_at is distinct from old.requested_at
  or (new.email is distinct from old.email
      and coalesce(current_setting('app.syncing_email', true), 'off') <> 'on') then
    raise exception 'Only an administrator can change role, status or employee link';
  end if;

  return new;
end$$;

drop trigger if exists profiles_guard_changes on public.profiles;
create trigger profiles_guard_changes
  before update on public.profiles
  for each row execute function public.guard_profile_changes();


create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 5. Mirror the profile→employee link into employees.auth_user_id
--    so older queries keep working off one source of truth.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sync_employee_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_employee uuid := null;
begin
  if tg_op = 'UPDATE' then
    v_old_employee := old.employee_id;
    if v_old_employee is not distinct from new.employee_id then
      return new;
    end if;
  end if;

  if v_old_employee is not null then
    update public.employees
       set auth_user_id = null
     where id = v_old_employee and auth_user_id = new.id;
  end if;

  if new.employee_id is not null then
    update public.employees
       set auth_user_id = null
     where auth_user_id = new.id and id <> new.employee_id;

    update public.employees
       set auth_user_id = new.id
     where id = new.employee_id;
  end if;

  return new;
end$$;

drop trigger if exists profiles_sync_employee on public.profiles;
create trigger profiles_sync_employee
  after insert or update on public.profiles
  for each row execute function public.sync_employee_link();


-- ─────────────────────────────────────────────────────────────
-- 6. Let an admin fully remove a login
--    (deleting from auth.users needs elevated rights, hence the
--     definer function — it re-checks the caller is an admin.)
-- ─────────────────────────────────────────────────────────────
create or replace function public.admin_delete_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can remove users';
  end if;

  if target = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;

  if exists (
        select 1 from public.profiles
         where id = target and role = 'admin' and status = 'approved'
     )
     and (select count(*) from public.profiles
           where role = 'admin' and status = 'approved') <= 1 then
    raise exception 'Cannot delete the last remaining admin';
  end if;

  delete from auth.users where id = target;
end$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 7. RLS on profiles
--    No INSERT policy on purpose: rows only ever come from the
--    definer-owned sign-up trigger / ensure_profile().
-- ─────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;

drop policy if exists "read profiles"       on public.profiles;
drop policy if exists "update own profile"  on public.profiles;
drop policy if exists "admin update profiles" on public.profiles;
drop policy if exists "admin delete profiles" on public.profiles;

-- Your own row always; admins see everyone (they need the pending
-- queue); approved users see other approved users.
create policy "read profiles" on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_admin()
  or (public.is_approved() and status = 'approved')
);

-- Privileged columns are held shut by the guard trigger above.
create policy "update own profile" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "admin update profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "admin delete profiles" on public.profiles for delete to authenticated
  using (public.is_admin());


-- ─────────────────────────────────────────────────────────────
-- 8. Rebuild the data-table policies around the 4-tier ladder
-- ─────────────────────────────────────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('employees','projects','tasks','milestones','documents','comments')
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end$$;

alter table public.employees  enable row level security;
alter table public.projects   enable row level security;
alter table public.tasks      enable row level security;
alter table public.milestones enable row level security;
alter table public.documents  enable row level security;
alter table public.comments   enable row level security;

-- READ everywhere requires an *approved* account. Pending sign-ups
-- get an empty database until an owner lets them in.

-- EMPLOYEES — the team roster is admin-managed
create policy "read employees" on employees for select to authenticated
  using (public.is_approved());
create policy "admin write employees" on employees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- PROJECTS — manager and above
create policy "read projects" on projects for select to authenticated
  using (public.is_approved());
create policy "manager write projects" on projects for all to authenticated
  using (public.has_min_role('manager')) with check (public.has_min_role('manager'));

-- MILESTONES — manager and above
create policy "read milestones" on milestones for select to authenticated
  using (public.is_approved());
create policy "manager write milestones" on milestones for all to authenticated
  using (public.has_min_role('manager')) with check (public.has_min_role('manager'));

-- TASKS — member and above
create policy "read tasks" on tasks for select to authenticated
  using (public.is_approved());
create policy "member write tasks" on tasks for all to authenticated
  using (public.has_min_role('member')) with check (public.has_min_role('member'));

-- DOCUMENTS — member and above
create policy "read documents" on documents for select to authenticated
  using (public.is_approved());
create policy "member write documents" on documents for all to authenticated
  using (public.has_min_role('member')) with check (public.has_min_role('member'));

-- COMMENTS — members post, admins moderate
create policy "read comments" on comments for select to authenticated
  using (public.is_approved());
create policy "member insert comments" on comments for insert to authenticated
  with check (public.has_min_role('member'));
create policy "admin manage comments" on comments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ─────────────────────────────────────────────────────────────
-- 9. Migrate the accounts that already exist
--    Today's admins stay admins. Everyone else becomes 'viewer',
--    which is the read-only access v2 gave them — promote from the
--    in-app Access page.
-- ─────────────────────────────────────────────────────────────
insert into public.profiles (id, email, full_name, role, status, approved_at, employee_id)
select
  u.id,
  u.email,
  coalesce(nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), e.name),
  case when coalesce(u.raw_app_meta_data ->> 'role', '') = 'admin' then 'admin' else 'viewer' end,
  'approved',
  now(),
  e.id
from auth.users u
left join public.employees e on e.auth_user_id = u.id
on conflict (id) do nothing;

-- Shout if the migration left nobody able to administer the app.
do $$
begin
  if not exists (select 1 from public.profiles where role = 'admin' and status = 'approved') then
    raise warning 'No approved admin exists. The next account to sign up will become the owner.';
  end if;
end$$;


-- ─────────────────────────────────────────────────────────────
-- 10. Sanity check — paste this into the SQL editor afterwards
-- ─────────────────────────────────────────────────────────────
-- select p.email, p.full_name, p.role, p.status, e.name as linked_employee
-- from public.profiles p
-- left join public.employees e on e.id = p.employee_id
-- order by p.status, p.role desc, p.email;
