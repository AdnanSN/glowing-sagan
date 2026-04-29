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

-- USER_ROLES (links Supabase auth users to employees and assigns app roles)
create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  role text not null default 'member' check (role in ('admin', 'manager', 'member', 'viewer')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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

-- ENABLE RLS
alter table employees enable row level security;
alter table projects enable row level security;
alter table tasks enable row level security;
alter table milestones enable row level security;
alter table documents enable row level security;
alter table comments enable row level security;
alter table user_roles enable row level security;

-- RLS policies: authenticated users can read/write all data (small team, internal tool)
-- Employees
create policy "Authenticated users can read employees" on employees for select to authenticated using (true);
create policy "Authenticated users can insert employees" on employees for insert to authenticated with check (true);
create policy "Authenticated users can update employees" on employees for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete employees" on employees for delete to authenticated using (true);

-- Projects
create policy "Authenticated users can read projects" on projects for select to authenticated using (true);
create policy "Authenticated users can insert projects" on projects for insert to authenticated with check (true);
create policy "Authenticated users can update projects" on projects for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete projects" on projects for delete to authenticated using (true);

-- Tasks
create policy "Authenticated users can read tasks" on tasks for select to authenticated using (true);
create policy "Authenticated users can insert tasks" on tasks for insert to authenticated with check (true);
create policy "Authenticated users can update tasks" on tasks for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete tasks" on tasks for delete to authenticated using (true);

-- Milestones
create policy "Authenticated users can read milestones" on milestones for select to authenticated using (true);
create policy "Authenticated users can insert milestones" on milestones for insert to authenticated with check (true);
create policy "Authenticated users can update milestones" on milestones for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete milestones" on milestones for delete to authenticated using (true);

-- Documents
create policy "Authenticated users can read documents" on documents for select to authenticated using (true);
create policy "Authenticated users can insert documents" on documents for insert to authenticated with check (true);
create policy "Authenticated users can update documents" on documents for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete documents" on documents for delete to authenticated using (true);

-- Comments
create policy "Authenticated users can read comments" on comments for select to authenticated using (true);
create policy "Authenticated users can insert comments" on comments for insert to authenticated with check (true);
create policy "Authenticated users can update comments" on comments for update to authenticated using (true) with check (true);
create policy "Authenticated users can delete comments" on comments for delete to authenticated using (true);

-- User Roles: users can read their own role, admins can manage all
create policy "Users can read own role" on user_roles for select to authenticated
  using (auth.uid() = auth_user_id);
create policy "Admin can read all roles" on user_roles for select to authenticated
  using (
    exists (
      select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin'
    )
  );
create policy "Users can insert own role" on user_roles for insert to authenticated
  with check (auth.uid() = auth_user_id);
create policy "Admin can insert roles" on user_roles for insert to authenticated
  with check (
    exists (
      select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin'
    )
  );
create policy "Admin can update roles" on user_roles for update to authenticated
  using (
    exists (
      select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin'
    )
  );
create policy "Admin can delete roles" on user_roles for delete to authenticated
  using (
    exists (
      select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin'
    )
  );
