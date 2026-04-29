-- ============================================================
-- MIGRATION: Add Role-Based Authentication
-- Run this in your Supabase SQL Editor
-- ============================================================

-- 1. Create the user_roles table
create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  role text not null default 'member' check (role in ('admin', 'manager', 'member', 'viewer')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Enable RLS on user_roles
alter table user_roles enable row level security;

-- 3. Drop old "allow all" policies (they allowed anon access)
drop policy if exists "Allow all on employees" on employees;
drop policy if exists "Allow all on projects" on projects;
drop policy if exists "Allow all on tasks" on tasks;
drop policy if exists "Allow all on milestones" on milestones;
drop policy if exists "Allow all on documents" on documents;
drop policy if exists "Allow all on comments" on comments;

-- 4. Create new authenticated-only policies

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

-- User Roles
create policy "Users can read own role" on user_roles for select to authenticated
  using (auth.uid() = auth_user_id);
create policy "Admin can read all roles" on user_roles for select to authenticated
  using (
    exists (select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin')
  );
create policy "Users can insert own role" on user_roles for insert to authenticated
  with check (auth.uid() = auth_user_id);
create policy "Admin can insert roles" on user_roles for insert to authenticated
  with check (
    exists (select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin')
  );
create policy "Admin can update roles" on user_roles for update to authenticated
  using (
    exists (select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin')
  );
create policy "Admin can delete roles" on user_roles for delete to authenticated
  using (
    exists (select 1 from user_roles ur where ur.auth_user_id = auth.uid() and ur.role = 'admin')
  );

-- ============================================================
-- 5. CREATE YOUR USERS
-- Go to Supabase Dashboard > Authentication > Users > Add User
-- Create accounts for each team member with email/password.
--
-- After creating users, link them to employees:
--
-- Replace the UUIDs below with actual values from:
--   - auth.users table (for auth_user_id)
--   - employees table (for employee_id)
--
-- Example:
-- INSERT INTO user_roles (auth_user_id, employee_id, role) VALUES
--   ('auth-user-uuid-for-aravinth',  'employee-uuid-for-aravinth',  'admin'),
--   ('auth-user-uuid-for-husain',    'employee-uuid-for-husain',    'manager'),
--   ('auth-user-uuid-for-nooriya',   'employee-uuid-for-nooriya',   'member'),
--   ('auth-user-uuid-for-4th-member','employee-uuid-for-4th-member','member');
-- ============================================================
