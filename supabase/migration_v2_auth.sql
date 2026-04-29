-- ============================================================
-- MIGRATION v2 — Simple Role-Based Auth (admin / member)
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Approach:
--   * Roles live in auth.users.raw_app_meta_data.role
--     (only the service role / dashboard can write app_metadata,
--      so users cannot escalate their own privileges)
--   * employees table gets an auth_user_id column linking
--     each employee row to the corresponding Supabase auth user
--   * RLS policies read role straight from the JWT — no recursive
--     table lookups, no user_roles table.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Drop the old user_roles table and its policies
-- ─────────────────────────────────────────────────────────────
drop policy if exists "Users can read own role"     on user_roles;
drop policy if exists "Admin can read all roles"    on user_roles;
drop policy if exists "Users can insert own role"   on user_roles;
drop policy if exists "Admin can insert roles"      on user_roles;
drop policy if exists "Admin can update roles"      on user_roles;
drop policy if exists "Admin can delete roles"      on user_roles;
drop table if exists user_roles cascade;


-- ─────────────────────────────────────────────────────────────
-- 2. Link employees to auth users
-- ─────────────────────────────────────────────────────────────
alter table employees
  add column if not exists auth_user_id uuid unique
  references auth.users(id) on delete set null;


-- ─────────────────────────────────────────────────────────────
-- 3. Helper: read role from JWT
-- ─────────────────────────────────────────────────────────────
create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'role',
    'member'
  );
$$;


-- ─────────────────────────────────────────────────────────────
-- 4. Drop ALL old permissive policies on every table
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


-- ─────────────────────────────────────────────────────────────
-- 5. New RLS policies
--    READ  → any authenticated user (admins & members both see everything)
--    WRITE → admins only
-- ─────────────────────────────────────────────────────────────

-- EMPLOYEES
create policy "read employees"   on employees for select to authenticated using (true);
create policy "admin write employees" on employees for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- PROJECTS
create policy "read projects"    on projects for select to authenticated using (true);
create policy "admin write projects" on projects for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- TASKS
create policy "read tasks"       on tasks for select to authenticated using (true);
create policy "admin write tasks" on tasks for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- MILESTONES
create policy "read milestones"  on milestones for select to authenticated using (true);
create policy "admin write milestones" on milestones for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- DOCUMENTS
create policy "read documents"   on documents for select to authenticated using (true);
create policy "admin write documents" on documents for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- COMMENTS
-- Members can post their own comments; admins can do anything.
create policy "read comments"    on comments for select to authenticated using (true);
create policy "auth insert comments" on comments for insert to authenticated with check (true);
create policy "admin manage comments" on comments for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');


-- ============================================================
-- 6. CREATE THE 4 LOGIN ACCOUNTS
-- ============================================================
-- Do this in Supabase Dashboard:
--   Authentication → Users → Add User → "Create new user"
--   ☑  Auto Confirm User  (so they don't need to verify email)
--
-- Create these accounts:
--
--   ┌──────────────────────────────┬────────────────────────┬────────┐
--   │ email                        │ password               │ role   │
--   ├──────────────────────────────┼────────────────────────┼────────┤
--   │ nooriya@nhn.local            │ NHN-Nooriya-2026!      │ admin  │
--   │ husain@nhn.local             │ NHN-Husain-2026!       │ admin  │
--   │ aravinth@nhn.local           │ NHN-Aravinth-2026!     │ member │
--   │ architect@nhn.local          │ NHN-Architect-2026!    │ member │
--   └──────────────────────────────┴────────────────────────┴────────┘
--
-- After creating them, run section 7 below.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 7. Assign roles + link to employee rows
--    Re-run any time you need to fix roles or add the 4th employee.
-- ─────────────────────────────────────────────────────────────

-- Admins (CEOs / Principal Architects)
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('role', 'admin')
where email in ('nooriya@nhn.local', 'husain@nhn.local');

-- Members (Senior Architects)
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                        || jsonb_build_object('role', 'member')
where email in ('aravinth@nhn.local', 'architect@nhn.local');


-- Link auth users to existing employee rows (matched by name).
-- Adjust the names if your employees table uses different spellings.
update employees set auth_user_id = (select id from auth.users where email = 'nooriya@nhn.local')
  where lower(name) = lower('Nooriya');

update employees set auth_user_id = (select id from auth.users where email = 'husain@nhn.local')
  where lower(name) = lower('Husain M nasrulla');

update employees set auth_user_id = (select id from auth.users where email = 'aravinth@nhn.local')
  where lower(name) = lower('Aravinth S');

-- 4th employee placeholder — only links if you've added a row named "Architect".
update employees set auth_user_id = (select id from auth.users where email = 'architect@nhn.local')
  where lower(name) = lower('Architect');


-- ─────────────────────────────────────────────────────────────
-- 8. Sanity check — paste this into the SQL editor afterwards
-- ─────────────────────────────────────────────────────────────
-- select u.email,
--        u.raw_app_meta_data ->> 'role' as role,
--        e.name as linked_employee
-- from auth.users u
-- left join employees e on e.auth_user_id = u.id
-- order by u.email;
