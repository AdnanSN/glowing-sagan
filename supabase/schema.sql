-- ============================================================
-- NHN Architects — Supabase Schema (fresh install)
-- For an existing project, run migration_v2_auth.sql instead.
-- ============================================================

-- EMPLOYEES (single source of truth for team members)
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,                       -- job title, e.g. "Senior Architect"
  email text,
  color text not null default '#C8A96E',
  avatar_url text,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  created_at timestamptz default now()
);

-- PROJECTS
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client text not null,
  project_type text not null default 'Residential',
  status text not null default 'Active', -- Active, Planning, Paused, Completed, Cancelled
  current_stage text not null default 'Briefing',
  color text not null default '#C8A96E',
  budget numeric,
  start_date date,
  end_date date,
  description text,
  location text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

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


-- ============================================================
-- AUTHORIZATION
-- Roles live in auth.users.raw_app_meta_data.role ('admin' | 'member').
-- Only the service role / dashboard can write app_metadata, so users
-- cannot escalate themselves. All RLS policies read role from the JWT.
-- ============================================================

create or replace function public.current_user_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'member');
$$;


-- ENABLE RLS
alter table employees  enable row level security;
alter table projects   enable row level security;
alter table tasks      enable row level security;
alter table milestones enable row level security;
alter table documents  enable row level security;
alter table comments   enable row level security;


-- READ: any authenticated user.   WRITE: admins only.

-- EMPLOYEES
create policy "read employees"        on employees for select to authenticated using (true);
create policy "admin write employees" on employees for all    to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- PROJECTS
create policy "read projects"         on projects for select to authenticated using (true);
create policy "admin write projects"  on projects for all    to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- TASKS
create policy "read tasks"            on tasks for select to authenticated using (true);
create policy "admin write tasks"     on tasks for all    to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- MILESTONES
create policy "read milestones"        on milestones for select to authenticated using (true);
create policy "admin write milestones" on milestones for all    to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- DOCUMENTS
create policy "read documents"        on documents for select to authenticated using (true);
create policy "admin write documents" on documents for all    to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

-- COMMENTS — anyone authenticated can post, only admins can edit/delete
create policy "read comments"         on comments for select to authenticated using (true);
create policy "auth insert comments"  on comments for insert to authenticated with check (true);
create policy "admin manage comments" on comments for all    to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');


-- ============================================================
-- INITIAL ACCOUNTS — see migration_v2_auth.sql sections 6 & 7
-- for the dashboard-add steps and the role-assignment SQL.
-- ============================================================
