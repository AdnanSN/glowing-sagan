-- ============================================================
-- MIGRATION v14 — Teams (named groups of people)
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- `employees` is the roster: everyone who works here, once each.
-- A team is a named group cut out of that roster — the four people on
-- the Riverside job, the two doing all the interiors — and a person is
-- in as many of them as their week actually involves.
--
-- WHY A JOIN TABLE AND NOT A COLUMN
--   A `team_id` on employees would allow exactly one team per person,
--   which is the one thing this is for. Membership is its own row, so
--   Nooriya can be on Riverside and on Interiors at the same time and
--   leaving one has no bearing on the other.
--
-- WHY THE PROJECT LINK IS OPTIONAL
--   Most teams here will be "the people on this job", so project_id
--   makes that the normal case rather than a naming convention. But a
--   standing group — Interiors, QA, whoever covers site visits —
--   outlives any one project, so the column is nullable and a team
--   with nothing in it is just as valid.
--
--   ON DELETE SET NULL: deleting a project never deletes the team that
--   worked on it. The team survives, unattached, and can be renamed,
--   pointed at the next job, or deleted deliberately.
--
-- WHAT DELETING TAKES WITH IT
--   Deleting a team removes its membership rows and nothing else — no
--   employee, no task, no project. Deleting an employee removes them
--   from every team they were in, leaving those teams intact.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The teams
-- ─────────────────────────────────────────────────────────────
create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  -- One line on what the group is for. Optional: a team called
  -- "Riverside Pavilion" has already explained itself.
  purpose    text,
  color      text not null default '#0041C2',
  -- Which job this group is for, when it is for one. See the note above.
  project_id uuid references public.projects(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Unique per project rather than globally: "Design Team" on two
-- different jobs is two real teams, but two of them on the same job is
-- a mistake. COALESCE gives unattached teams their own namespace —
-- without it NULLs count as distinct and you could make ten standing
-- teams all called "Interiors". Case-insensitive, so "interiors"
-- cannot sneak past it either.
create unique index if not exists teams_name_per_project_unique
  on public.teams (
    lower(name),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists teams_project_idx on public.teams (project_id);


-- ─────────────────────────────────────────────────────────────
-- 2. Who is in them
-- ─────────────────────────────────────────────────────────────
create table if not exists public.team_members (
  team_id     uuid not null references public.teams(id)     on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  added_at    timestamptz not null default now(),
  -- The composite key is the rule: once per team, any number of teams.
  primary key (team_id, employee_id)
);

-- The primary key already indexes team → people. This is the other
-- direction, for "which teams is this person in", which the roster
-- asks once per card.
create index if not exists team_members_employee_idx
  on public.team_members (employee_id);


-- ─────────────────────────────────────────────────────────────
-- 3. Is this team's project one you are allowed to see?
--    A team on a confidential job would otherwise name that job in a
--    list anyone can read. Definer so it can read `teams` without
--    re-entering the policy that is written in terms of it.
--    project_visible() already answers true for a null project, so an
--    unattached team is visible to everyone approved.
-- ─────────────────────────────────────────────────────────────
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


-- ─────────────────────────────────────────────────────────────
-- 4. RLS — the same ladder as the roster itself: everyone approved
--    reads, admins (Principal Architects) write. Teams are edited on
--    the Team page, which is already admin-only in the app; this is
--    what makes that mean something rather than being a hidden button.
-- ─────────────────────────────────────────────────────────────
alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

drop policy if exists "read teams"          on public.teams;
drop policy if exists "admin write teams"   on public.teams;
drop policy if exists "read team members"        on public.team_members;
drop policy if exists "admin write team members" on public.team_members;

create policy "read teams" on public.teams
  for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));

create policy "admin write teams" on public.teams
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "read team members" on public.team_members
  for select to authenticated
  using (public.is_approved() and public.team_visible(team_id));

create policy "admin write team members" on public.team_members
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ─────────────────────────────────────────────────────────────
-- 5. Sanity check — paste this in afterwards
-- ─────────────────────────────────────────────────────────────
-- select t.name as team,
--        coalesce(p.name, '(no project)') as project,
--        count(m.employee_id) as members
-- from public.teams t
-- left join public.projects p     on p.id = t.project_id
-- left join public.team_members m on m.team_id = t.id
-- group by t.name, p.name
-- order by t.name;
