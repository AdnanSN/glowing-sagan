// Supabase DB schema - run this in your Supabase SQL Editor

-- EMPLOYEES
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  email text,
  color text not null default '#C8A96E',
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
  start_date date,                        -- for Gantt chart
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
  doc_type text default 'Other', -- Drawing, Contract, Permit, Report, Specification, Other
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

-- ENABLE RLS (no policies for internal tool - all access)
alter table employees enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table milestones enable row level security;
alter table documents enable row level security;
alter table comments enable row level security;

-- Allow all operations for anon users (internal tool, no auth)
create policy "Allow all on employees" on employees for all using (true) with check (true);
create policy "Allow all on projects" on projects for all using (true) with check (true);
create policy "Allow all on tasks" on tasks for all using (true) with check (true);
create policy "Allow all on milestones" on milestones for all using (true) with check (true);
create policy "Allow all on documents" on documents for all using (true) with check (true);
create policy "Allow all on comments" on comments for all using (true) with check (true);
