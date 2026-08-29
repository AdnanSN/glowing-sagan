-- ============================================================
-- NHN Architects — Supabase Schema (fresh install)
--
-- For an EXISTING project, do not run this. Run the migrations in
-- order instead: migration_v2_auth.sql, migration_v3_self_signup.sql,
-- migration_v4_avatars.sql, migration_v5_folders.sql,
-- migration_v6_project_stages.sql, migration_v7_drop_budget.sql,
-- migration_v8_confidential.sql, migration_v9_gantt.sql,
-- migration_v10_site_photos.sql, migration_v11_task_notes.sql,
-- migration_v12_nas_links.sql, migration_v13_remove_nas_links.sql,
-- then migration_v14_teams.sql.
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

-- TEAMS (a named group cut out of the roster — usually the people on
-- one job. Sits here rather than up with employees because it
-- references projects. See migration_v14_teams.sql for the reasoning;
-- the short version is that membership is its own row so one person
-- can be on as many teams as their week actually involves, and the
-- project link is optional so a standing group can outlive any job.)
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  purpose text,                             -- optional one-liner
  color text not null default '#0041C2',
  -- SET NULL: deleting a project never deletes the team that worked
  -- on it; the team survives unattached.
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Unique per project: "Design Team" on two jobs is two real teams, two
-- on the same job is a mistake. COALESCE gives unattached teams their
-- own namespace, since NULLs would otherwise all count as distinct.
create unique index if not exists teams_name_per_project_unique
  on teams (
    lower(name),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists teams_project_idx on teams (project_id);

-- TEAM MEMBERSHIP — the composite key is the rule: once per team,
-- any number of teams.
create table if not exists team_members (
  team_id     uuid not null references teams(id)     on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (team_id, employee_id)
);

-- The primary key covers team → people; this is "which teams is this
-- person in", which the roster asks once per card.
create index if not exists team_members_employee_idx
  on team_members (employee_id);

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

-- TASK NOTES (what happened on one day of one line item — written by
-- clicking that square on either timeline chart. See
-- migration_v11_task_notes.sql for the reasoning; the short version is
-- that a line runs for weeks and "the steel is late" is about a
-- Tuesday, so the day is part of the key rather than a timestamp on a
-- flat comment list.)
create table if not exists task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks(id) on delete cascade,
  -- The square this was written on. Deliberately not constrained to the
  -- task's own dates: bars move, and a note stays on the day it is
  -- about.
  note_date date not null,
  body text not null,
  author_id   uuid references employees(id) on delete set null,
  -- A snapshot, not a join — a note should still say who wrote it after
  -- the employee row is archived.
  author_name text,
  -- Ownership for editing: the login rather than the employee row, so
  -- somebody not yet linked to an employee can still edit what they
  -- just wrote.
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_notes_body_not_blank check (length(btrim(body)) > 0)
);

create index if not exists task_notes_task_date_idx
  on task_notes (task_id, note_date, created_at);

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

-- SITE PHOTOS (what the job actually looks like — taken on a phone,
-- standing in the building. See migration_v10_site_photos.sql for the
-- full reasoning; the short version is that the browser ships a 2048px
-- WebP plus a 480px thumbnail and the raw camera file never leaves the
-- phone, and that the bucket is private because a confidential project
-- must not leak its photos to whoever is holding the URL.)
create table if not exists site_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- Both objects live under <project_id>/ in the `site-photos` bucket,
  -- so one path segment tells the storage policies which project they
  -- have to check.
  storage_path text not null unique,
  thumb_path   text not null,
  caption text,
  stage text,                               -- matches projects.stages, like tasks.stage
  taken_at timestamptz,                     -- from the file where the phone gave us one
  bytes  int,                               -- full derivative, for the quota readout
  width  int,
  height int,
  uploaded_by uuid references employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists site_photos_project_taken_idx
  on site_photos (project_id, taken_at desc, created_at desc);

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

-- Is this team's project one you are allowed to see? A team on a
-- confidential job would otherwise name that job in a list anyone can
-- read. project_visible() answers true for a null project, so an
-- unattached team is visible to everyone approved.
create or replace function public.team_visible(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams t
     where t.id = p_team
       and public.project_visible(t.project_id)
  );
$$;

revoke all on function public.team_visible(uuid) from public, anon;
grant execute on function public.team_visible(uuid) to authenticated;

-- "Is this employee row me?" Used by the site-photo policies below and
-- by the storage policies at the bottom of this file. Definer so it can
-- read `employees` without tripping that table's own RLS.
create or replace function public.owns_employee(emp uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select emp is not null and exists (
    select 1 from public.employees where id = emp and auth_user_id = auth.uid()
  );
$$;

-- Governs a task's notes. Not the same question as project_visible():
-- a task carries its own is_confidential, so this mirrors the "read
-- tasks" policy below clause for clause. Definer so it can read `tasks`
-- without re-entering that table's own RLS.
create or replace function public.task_visible(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task
       and (
         public.is_admin()
         or (not t.is_confidential and public.project_visible(t.project_id))
       )
  );
$$;

revoke all on function public.task_visible(uuid) from public, anon;
grant execute on function public.task_visible(uuid) to authenticated;

-- Storage object names carry ids in their first path segment; a
-- malformed path must fail the policy rather than raise a cast error.
create or replace function public.try_uuid(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end$$;


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

drop trigger if exists task_notes_touch_updated_at on task_notes;
create trigger task_notes_touch_updated_at before update on task_notes
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
alter table teams        enable row level security;
alter table team_members enable row level security;
alter table tasks      enable row level security;
alter table task_notes enable row level security;
alter table milestones enable row level security;
alter table documents   enable row level security;
alter table site_photos enable row level security;
alter table comments    enable row level security;
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

-- TEAMS — same ladder as the roster they are cut from: everyone
-- approved reads, admins write. A team on a confidential project is
-- hidden along with it.
create policy "read teams" on teams for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));
create policy "admin write teams" on teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "read team members" on team_members for select to authenticated
  using (public.is_approved() and public.team_visible(team_id));
create policy "admin write team members" on team_members for all to authenticated
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

-- TASK NOTES — reading follows the task. Writing is member and above,
-- the same rung that may edit the task itself. Editing is your own
-- only, including for admins: rewriting somebody else's note silently
-- is worse than deleting it, which at least leaves a hole. Deleting is
-- your own or a project lead, the same shape as site photos.
create policy "read task notes" on task_notes for select to authenticated
  using (public.is_approved() and public.task_visible(task_id));
create policy "member add task notes" on task_notes for insert to authenticated
  with check (
    public.has_min_role('member')
    and public.task_visible(task_id)
    and created_by = auth.uid()                              -- post as yourself only
    and (author_id is null or public.owns_employee(author_id))
  );
create policy "edit own task notes" on task_notes for update to authenticated
  using      (public.task_visible(task_id) and created_by = auth.uid())
  with check (public.task_visible(task_id) and created_by = auth.uid());
create policy "delete own task notes" on task_notes for delete to authenticated
  using (public.task_visible(task_id)
         and (public.has_min_role('manager') or created_by = auth.uid()));

-- DOCUMENTS — member and above, following their project
create policy "read documents" on documents for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));
create policy "member write documents" on documents for all to authenticated
  using      (public.has_min_role('member') and public.project_visible(project_id))
  with check (public.has_min_role('member') and public.project_visible(project_id));

-- SITE PHOTOS — read follows the project, adding is member and above
-- (the same rung as documents). Removing is deliberately narrower:
-- your own upload, or a project lead. A site record is evidence, and
-- one person should not be able to quietly drop somebody else's.
create policy "read site photos" on site_photos for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));
create policy "member add site photos" on site_photos for insert to authenticated
  with check (public.has_min_role('member') and public.project_visible(project_id));
create policy "edit own site photos" on site_photos for update to authenticated
  using      (public.project_visible(project_id)
              and (public.has_min_role('manager') or public.owns_employee(uploaded_by)))
  with check (public.project_visible(project_id)
              and (public.has_min_role('manager') or public.owns_employee(uploaded_by)));
create policy "delete own site photos" on site_photos for delete to authenticated
  using (public.project_visible(project_id)
         and (public.has_min_role('manager') or public.owns_employee(uploaded_by)));

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

-- try_uuid() and owns_employee(), which the policies below are written
-- in terms of, are defined up in AUTHORIZATION HELPERS — the site-photo
-- policies need them too, and those are created before this section.

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
-- STORAGE — site photos
-- Private, unlike `avatars`: a confidential project must not hand its
-- photos to whoever is holding the URL. Nothing is served without a
-- signed URL, and the policies below decide who may be given one.
-- Every object sits at site-photos/<project_id>/<key>, so the first
-- path segment is what they key off — and a path that does not start
-- with a real uuid is refused outright, because project_visible(null)
-- is true by design and would otherwise wave it through.
--
-- The browser ships a 2048px WebP (capped at 700 KB) plus a 480px
-- thumbnail; the raw camera file never leaves the phone. 1.5 MB / image
-- mimes is a backstop against someone bypassing the app.
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-photos', 'site-photos', false, 1572864, array['image/webp', 'image/jpeg'])
on conflict (id) do update set
  public = false, file_size_limit = 1572864,
  allowed_mime_types = array['image/webp', 'image/jpeg'];

create or replace function public.site_photo_project(objname text)
returns uuid language sql immutable set search_path = public as $$
  select public.try_uuid((storage.foldername(objname))[1]);
$$;

-- Removing an object: a project lead, or whoever uploaded the photo it
-- belongs to. The app deletes objects BEFORE the row, so the row is
-- still there to be asked.
create or replace function public.can_remove_site_photo(objname text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_min_role('manager')
      or exists (
           select 1 from public.site_photos sp
            where (sp.storage_path = objname or sp.thumb_path = objname)
              and public.owns_employee(sp.uploaded_by)
         );
$$;

revoke all on function public.site_photo_project(text)    from public, anon;
revoke all on function public.can_remove_site_photo(text) from public, anon;
grant execute on function public.site_photo_project(text)    to authenticated;
grant execute on function public.can_remove_site_photo(text) to authenticated;

drop policy if exists "read site photo objects" on storage.objects;
create policy "read site photo objects" on storage.objects for select to authenticated
using (bucket_id = 'site-photos' and public.is_approved()
  and public.site_photo_project(name) is not null
  and public.project_visible(public.site_photo_project(name)));

drop policy if exists "upload site photo objects" on storage.objects;
create policy "upload site photo objects" on storage.objects for insert to authenticated
with check (bucket_id = 'site-photos' and public.has_min_role('member')
  and public.site_photo_project(name) is not null
  and public.project_visible(public.site_photo_project(name)));

drop policy if exists "delete site photo objects" on storage.objects;
create policy "delete site photo objects" on storage.objects for delete to authenticated
using (bucket_id = 'site-photos'
  and public.site_photo_project(name) is not null
  and public.project_visible(public.site_photo_project(name))
  and public.can_remove_site_photo(name));

-- No update policy on purpose: every upload gets a fresh key, so an
-- object is written once and never overwritten — which is also why a
-- signed URL can be cached for its whole life without going stale.


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
