-- ============================================================
-- NHN Architects — Supabase Schema (fresh install)
--
-- For an EXISTING project, do not run this. Run the migrations in
-- order instead: migration_v2_auth.sql, migration_v3_self_signup.sql,
-- migration_v4_avatars.sql, migration_v5_folders.sql,
-- migration_v6_project_stages.sql, migration_v7_drop_budget.sql,
-- migration_v8_confidential.sql, then migration_v9_gantt.sql.
--
-- Access model (see migration_v3_self_signup.sql for the full notes):
--   Employees sign themselves up. Every new account lands as
--   role='viewer', status='pending' and can read nothing until an
--   admin approves it from the in-app Access page.
--   Roles: admin (100) > manager (70) > member (40) > viewer (10).
--   The first account created on a fresh install becomes the admin.
-- ============================================================

-- EMPLOYEES (the team roster — a person on the org chart)
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,                       -- job title, e.g. "Senior Architect"
  email text,
  color text not null default '#C8A96E',
  avatar_url text,                          -- public URL of their photo, see the STORAGE section
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- PROJECT FOLDERS (how you file projects — renameable, and kept
-- deliberately separate from projects.status, which is what a project IS)
create table if not exists project_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,          -- display order; ties break on name
  -- Principal Architects only: hides the folder AND everything filed
  -- in it from everyone else. Enforced in RLS, see migration_v8.
  is_confidential boolean not null default false,
  created_at timestamptz not null default now()
);

-- Two folders with the same name would be a filing system that lies.
create unique index if not exists project_folders_name_unique
  on project_folders (lower(name));

-- PROJECTS
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text not null,
  -- The two header fields on the practice's timeline sheet. Free text:
  -- a project number is a filing convention, not a key.
  project_number text,
  revision text,
  -- SET NULL: deleting a folder files its contents under "Unfiled",
  -- it never deletes projects.
  folder_id uuid references project_folders(id) on delete set null,
  project_type text not null default 'Residential',
  status text not null default 'Active', -- Active, Planning, Paused, Completed, Cancelled
  current_stage text not null default 'Briefing',
  -- Each project owns its own ordered stage list; current_stage names
  -- one of these. Kept as an array because it is always read whole,
  -- alongside the project row, and never queried across projects.
  stages text[] not null default array[
    'Briefing', 'Schematic Design', 'Design Development',
    'Construction Docs', 'Tender', 'Construction', 'Handover'
  ],
  color text not null default '#C8A96E',
  -- Principal Architects only: hides the project and everything that
  -- belongs to it. A project in a confidential folder is restricted
  -- too, whatever this says.
  is_confidential boolean not null default false,
  start_date date,
  end_date date,
  description text,
  location text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint projects_stages_not_empty check (array_length(stages, 1) >= 1)
);

-- TASKS
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'To Do', -- To Do, In Progress, In Review, Done
  priority text not null default 'Medium', -- Low, Medium, High
  assignee_id uuid references employees(id) on delete set null,
  start_date date,
  due_date date,
  stage text,
  -- Per cent complete, as the timeline sheet has always tracked it.
  -- Deliberately not derived from status: "In Progress" covers
  -- everything from 5% to 95%.
  progress smallint not null default 0,
  -- Order within a stage, so 1.1 / 1.2 / 1.3 stay where they were put
  -- rather than re-sorting by created_at when a line is inserted.
  position int not null default 0,
  -- Principal Architects only: one task inside an otherwise ordinary
  -- project.
  is_confidential boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint tasks_progress_range check (progress between 0 and 100)
);

create index if not exists tasks_project_stage_position_idx
  on tasks (project_id, stage, position);

-- MILESTONES
create table if not exists milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  title text not null,
  due_date date,
  is_completed boolean default false,
  created_at timestamptz default now()
);

-- DOCUMENTS
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  name text not null,
  url text,
  doc_type text default 'Other',
  uploaded_by text,
  notes text,
  created_at timestamptz default now()
);

-- COMMENTS
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  author text not null,
  content text not null,
  created_at timestamptz default now()
);

-- PROFILES (one row per login — who they are and what they may do)
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  full_name    text,
  role         text        not null default 'viewer'
                 check (role in ('admin', 'manager', 'member', 'viewer')),
  status       text        not null default 'pending'
                 check (status in ('pending', 'approved', 'suspended', 'rejected')),
  employee_id  uuid        references employees(id) on delete set null,
  requested_at timestamptz not null default now(),
  approved_at  timestamptz,
  approved_by  uuid        references auth.users(id) on delete set null,
  updated_at   timestamptz not null default now()
);

create index if not exists profiles_status_idx   on profiles (status);
create index if not exists profiles_employee_idx on profiles (employee_id);
create unique index if not exists profiles_employee_unique
  on profiles (employee_id) where employee_id is not null;


-- ============================================================
-- AUTHORIZATION HELPERS
-- SECURITY DEFINER so they can read `profiles` without tripping
-- the very policies that are written in terms of them.
-- ============================================================

create or replace function public.role_rank(r text)
returns int language sql immutable as $$
  select case r
    when 'admin'   then 100
    when 'manager' then 70
    when 'member'  then 40
    when 'viewer'  then 10
    else 0
  end;
$$;

-- 'none' for anyone not approved → every policy fails closed.
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.role from public.profiles p
      where p.id = auth.uid() and p.status = 'approved'),
    'none'
  );
$$;

create or replace function public.has_min_role(min_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.role_rank(public.current_user_role()) >= public.role_rank(min_role);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select public.role_rank(public.current_user_role()) > 0;
$$;

-- Confidential work is Principal Architects (admins) only. These two
-- answer "is this row restricted" for the policies below; definer so
-- they can read the parent row without re-entering those policies.
create or replace function public.folder_is_confidential(p_folder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select f.is_confidential from public.project_folders f where f.id = p_folder),
    false
  );
$$;

-- Governs everything that belongs to a project. A row with no
-- project_id is not restricted by association.
create or replace function public.project_visible(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or p_project is null
      or exists (
           select 1 from public.projects pr
            where pr.id = p_project
              and not pr.is_confidential
              and not public.folder_is_confidential(pr.folder_id)
         );
$$;

revoke all on function public.folder_is_confidential(uuid) from public, anon;
revoke all on function public.project_visible(uuid)        from public, anon;
grant execute on function public.folder_is_confidential(uuid) to authenticated;
grant execute on function public.project_visible(uuid)        to authenticated;


-- ============================================================
-- SIGN-UP → PROFILE
-- ============================================================

create or replace function public.create_profile_for(
  p_user_id uuid, p_email text, p_full_name text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_bootstrap boolean;
begin
  -- First account on a fresh install becomes the owner, otherwise
  -- nobody could ever approve anyone.
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

revoke all on function public.create_profile_for(uuid, text, text)
  from public, anon, authenticated;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.create_profile_for(
    new.id, new.email, new.raw_user_meta_data ->> 'full_name');
  return new;
end$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = public as $$
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

-- Safety net the app calls if a signed-in user has no profile row.
create or replace function public.ensure_profile()
returns public.profiles language plpgsql security definer set search_path = public as $$
declare
  v_email text; v_full_name text; v_profile public.profiles;
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


-- ============================================================
-- GUARDS — nobody escalates themselves, the last admin can't be
-- locked out.
-- ============================================================

create or replace function public.guard_profile_changes()
returns trigger language plpgsql security definer set search_path = public as $$
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

drop trigger if exists profiles_guard_changes on profiles;
create trigger profiles_guard_changes before update on profiles
  for each row execute function public.guard_profile_changes();

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists profiles_touch_updated_at on profiles;
create trigger profiles_touch_updated_at before update on profiles
  for each row execute function public.touch_updated_at();

-- Mirror profiles.employee_id into employees.auth_user_id.
create or replace function public.sync_employee_link()
returns trigger language plpgsql security definer set search_path = public as $$
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
    update public.employees set auth_user_id = null
     where id = v_old_employee and auth_user_id = new.id;
  end if;

  if new.employee_id is not null then
    update public.employees set auth_user_id = null
     where auth_user_id = new.id and id <> new.employee_id;
    update public.employees set auth_user_id = new.id
     where id = new.employee_id;
  end if;

  return new;
end$$;

drop trigger if exists profiles_sync_employee on profiles;
create trigger profiles_sync_employee after insert or update on profiles
  for each row execute function public.sync_employee_link();

-- Deleting from auth.users needs elevated rights; re-checks the caller.
create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can remove users';
  end if;
  if target = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;
  if exists (select 1 from public.profiles
              where id = target and role = 'admin' and status = 'approved')
     and (select count(*) from public.profiles
           where role = 'admin' and status = 'approved') <= 1 then
    raise exception 'Cannot delete the last remaining admin';
  end if;

  delete from auth.users where id = target;
end$$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- ============================================================
-- ROW LEVEL SECURITY
-- READ requires an approved account. WRITE follows the ladder.
-- ============================================================

alter table employees       enable row level security;
alter table project_folders enable row level security;
alter table projects   enable row level security;
alter table tasks      enable row level security;
alter table milestones enable row level security;
alter table documents  enable row level security;
alter table comments   enable row level security;
alter table profiles   enable row level security;

-- PROFILES — no INSERT policy on purpose: rows only ever come from
-- the definer-owned sign-up trigger / ensure_profile().
create policy "read profiles" on profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_admin()
  or (public.is_approved() and status = 'approved')
);
create policy "update own profile" on profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "admin update profiles" on profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "admin delete profiles" on profiles for delete to authenticated
  using (public.is_admin());

-- EMPLOYEES — admin-managed roster
create policy "read employees" on employees for select to authenticated
  using (public.is_approved());
create policy "admin write employees" on employees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Confidential rows are admin-only throughout: the checks below are
-- what makes "Principal Architects only" mean it. A non-admin never
-- receives the row, and cannot flag, unflag or edit one either.

-- PROJECT FOLDERS — manager and above reorganise
create policy "read project folders" on project_folders for select to authenticated
  using (public.is_approved() and (public.is_admin() or not is_confidential));
create policy "manager write project folders" on project_folders for all to authenticated
  using      (public.has_min_role('manager') and (public.is_admin() or not is_confidential))
  with check (public.has_min_role('manager') and (public.is_admin() or not is_confidential));

-- PROJECTS — manager and above; restricted in their own right or by folder
create policy "read projects" on projects for select to authenticated
  using (
    public.is_approved() and (
      public.is_admin()
      or (not is_confidential and not public.folder_is_confidential(folder_id))
    )
  );
create policy "manager write projects" on projects for all to authenticated
  using (
    public.has_min_role('manager') and (
      public.is_admin()
      or (not is_confidential and not public.folder_is_confidential(folder_id))
    )
  )
  with check (
    public.has_min_role('manager') and (
      public.is_admin()
      or (not is_confidential and not public.folder_is_confidential(folder_id))
    )
  );

-- MILESTONES — manager and above, following their project
create policy "read milestones" on milestones for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));
create policy "manager write milestones" on milestones for all to authenticated
  using      (public.has_min_role('manager') and public.project_visible(project_id))
  with check (public.has_min_role('manager') and public.project_visible(project_id));

-- TASKS — member and above; restricted on their own or by their project
create policy "read tasks" on tasks for select to authenticated
  using (
    public.is_approved() and (
      public.is_admin()
      or (not is_confidential and public.project_visible(project_id))
    )
  );
create policy "member write tasks" on tasks for all to authenticated
  using (
    public.has_min_role('member') and (
      public.is_admin()
      or (not is_confidential and public.project_visible(project_id))
    )
  )
  with check (
    public.has_min_role('member') and (
      public.is_admin()
      or (not is_confidential and public.project_visible(project_id))
    )
  );

-- DOCUMENTS — member and above, following their project
create policy "read documents" on documents for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));
create policy "member write documents" on documents for all to authenticated
  using      (public.has_min_role('member') and public.project_visible(project_id))
  with check (public.has_min_role('member') and public.project_visible(project_id));

-- COMMENTS — members post, admins moderate
create policy "read comments" on comments for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));
create policy "member insert comments" on comments for insert to authenticated
  with check (public.has_min_role('member') and public.project_visible(project_id));
create policy "admin manage comments" on comments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());


-- ============================================================
-- STORAGE — profile photos
-- One object per person at avatars/<employee_id>/avatar, uploaded
-- with upsert, so storage is bounded by headcount rather than by how
-- often people change their picture. The browser downscales to a
-- 256px WebP square first (src/lib/avatar.js) — ~5–10 KB each.
-- ============================================================

-- The first path segment is an employee id; a malformed path must
-- fail the policy rather than raise a cast error.
create or replace function public.try_uuid(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end$$;

create or replace function public.owns_employee(emp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select emp is not null and exists (
    select 1 from public.employees where id = emp and auth_user_id = auth.uid()
  );
$$;

-- 512 KB / image mimes is a backstop against someone bypassing the
-- app and parking a raw camera file in the quota.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  public = true, file_size_limit = 524288,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

-- Read is open — that is what makes the bucket CDN-cacheable. Writes
-- are your own folder only, or anyone's if you are an admin (so a
-- colleague without a login can still be given a picture).
drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "upload own avatar" on storage.objects;
create policy "upload own avatar" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (public.is_admin()
  or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "replace own avatar" on storage.objects;
create policy "replace own avatar" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (public.is_admin()
  or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))))
with check (bucket_id = 'avatars' and (public.is_admin()
  or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))));

drop policy if exists "delete own avatar" on storage.objects;
create policy "delete own avatar" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (public.is_admin()
  or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))));

-- `employees` is admin-write only, so an ordinary user cannot update
-- their own row. This is the one narrow hole in that wall: avatar_url
-- only, on the row linked to the caller's login only.
create or replace function public.set_my_avatar(p_url text)
returns public.employees
language plpgsql security definer set search_path = public as $$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_emp public.employees;
begin
  if not public.is_approved() then
    raise exception 'Your account has not been approved yet';
  end if;

  -- Only an image we host. Otherwise a user could point their avatar
  -- at any external URL, which then loads in every teammate's browser.
  if v_url is not null
     and v_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/avatars/' then
    raise exception 'Avatar must be an uploaded image';
  end if;

  update public.employees set avatar_url = v_url
   where auth_user_id = auth.uid()
  returning * into v_emp;

  if v_emp.id is null then
    raise exception 'Your login is not linked to a team member yet — ask an administrator to link it on the Access page';
  end if;

  return v_emp;
end$$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;


-- ============================================================
-- SAVING A NEW STAGE LIST
-- current_stage and tasks.stage refer to stages BY NAME, so a rename
-- or a delete has to be tidied up in the same breath. One function so
-- all of it lands in a single transaction.
-- p_renames maps old -> new, e.g. {"Tender": "Tender & Award"}
-- ============================================================
create or replace function public.update_project_stages(
  p_project uuid, p_stages text[], p_renames jsonb default '{}'::jsonb
)
returns public.projects
language plpgsql security definer set search_path = public as $$
declare
  v_project public.projects;
  v_old text; v_new text; v_count int;
begin
  if not public.has_min_role('manager') then
    raise exception 'Only a project lead or administrator can change stages';
  end if;

  -- Definer, so RLS does not apply in here — a restricted project has
  -- to be turned away explicitly. Same wording as a missing id, so it
  -- does not confirm what exists.
  if not public.project_visible(p_project) then
    raise exception 'Project not found';
  end if;

  v_count := coalesce(array_length(p_stages, 1), 0);
  if v_count = 0 then
    raise exception 'A project needs at least one stage';
  end if;
  if exists (select 1 from unnest(p_stages) s where btrim(coalesce(s, '')) = '') then
    raise exception 'Stage names cannot be blank';
  end if;
  if (select count(distinct lower(btrim(s))) from unnest(p_stages) s) <> v_count then
    raise exception 'Stage names must be unique';
  end if;

  -- Renames first, so the checks below compare against the new names.
  for v_old, v_new in select key, value #>> '{}' from jsonb_each(p_renames) loop
    update public.tasks set stage = v_new
     where project_id = p_project and stage = v_old;
    update public.projects set current_stage = v_new
     where id = p_project and current_stage = v_old;
  end loop;

  update public.projects set stages = p_stages, updated_at = now()
   where id = p_project returning * into v_project;

  if v_project.id is null then
    raise exception 'Project not found';
  end if;

  -- Deleting the stage a project sits on must not leave it pointing
  -- at nothing.
  if not (v_project.current_stage = any(p_stages)) then
    update public.projects set current_stage = p_stages[1]
     where id = p_project returning * into v_project;
  end if;

  -- Keep the task, drop the label that no longer exists.
  update public.tasks set stage = null
   where project_id = p_project and stage is not null
     and not (stage = any(p_stages));

  return v_project;
end$$;

revoke all on function public.update_project_stages(uuid, text[], jsonb) from public, anon;
grant execute on function public.update_project_stages(uuid, text[], jsonb) to authenticated;


-- ============================================================
-- STARTING FOLDERS
-- Only on a genuinely empty table, so re-running this file never
-- resurrects a folder somebody deleted.
-- ============================================================
insert into project_folders (name, position)
select * from (values ('Ongoing', 1), ('On Hold', 2), ('Completed', 3)) as v(name, position)
where not exists (select 1 from project_folders);


-- ============================================================
-- FIRST RUN
-- Open the app, click "Request access" and register. Because no
-- admin exists yet, that first account is created as an approved
-- admin. Everyone after them lands in the pending queue on the
-- Access page.
-- ============================================================
