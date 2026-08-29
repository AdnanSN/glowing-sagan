-- ============================================================
-- MIGRATION v15 — More than one person on a task
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- A line item has always pointed at exactly one employee through
-- tasks.assignee_id, and real work does not. A set of drawings goes to
-- two people; a site visit goes to whoever is going. Until now the
-- second name lived in the title, or nowhere.
--
-- WHY A JOIN TABLE AND NOT A SECOND COLUMN
--   assignee_id, assignee_2_id, assignee_3_id is a question about how
--   many people fit, asked once a year, answered wrong every time. A
--   row per person answers it permanently, and it is what lets the Team
--   Schedule list one shared task under both of the people on it —
--   which is the whole point of that view.
--
-- WHAT HAPPENS TO tasks.assignee_id
--   It stays, and it becomes derived: the lead — the first person on
--   the list. Every surface that has room for exactly one face (a 40px
--   Gantt bar, a card corner) keeps reading it and keeps working, and
--   the trigger below keeps it honest. Nothing writes it by hand any
--   more; write task_assignees and this follows.
--
--   That means it is now safe to reassign from the table editor too:
--   change the rows here and the lead re-derives itself.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The table
--    `position` is the order the names were picked, which is also who
--    the lead is. It is not a rank — nobody is in charge of anybody —
--    it just makes "the one face we have room for" a stable answer
--    instead of whichever row the database happened to return first.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.task_assignees (
  task_id     uuid not null references public.tasks(id)     on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  primary key (task_id, employee_id)
);

-- "What is on Priya's plate", across every project — the Team
-- Schedule's and the roster's only question.
create index if not exists task_assignees_employee_idx
  on public.task_assignees (employee_id);

-- The lead lookup below, and the panel reading one task's list.
create index if not exists task_assignees_task_position_idx
  on public.task_assignees (task_id, position);


-- ─────────────────────────────────────────────────────────────
-- 2. Backfill — everyone who is already assigned to something
--    keeps it. Runs before the trigger exists, so it cannot fight it.
-- ─────────────────────────────────────────────────────────────
insert into public.task_assignees (task_id, employee_id, position)
select t.id, t.assignee_id, 0
  from public.tasks t
 where t.assignee_id is not null
on conflict (task_id, employee_id) do nothing;


-- ─────────────────────────────────────────────────────────────
-- 3. tasks.assignee_id becomes the lead, maintained here
--    Definer so it can write `tasks` without re-entering that table's
--    policies — the caller has already been allowed to change the
--    assignment by task_assignees' own policy, and this is just the
--    consequence of that change.
-- ─────────────────────────────────────────────────────────────
create or replace function public.sync_task_lead_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Which task's lead needs recomputing. Branching on the operation
  -- rather than coalescing NEW and OLD: PL/pgSQL leaves NEW unassigned
  -- on a DELETE, and touching it there is an error, not a null.
  ids uuid[];
begin
  if tg_op = 'DELETE' then
    ids := array[old.task_id];
  elsif tg_op = 'INSERT' then
    ids := array[new.task_id];
  else
    ids := array[new.task_id, old.task_id];
  end if;

  update public.tasks t
     set assignee_id = (
           select a.employee_id
             from public.task_assignees a
            where a.task_id = t.id
            order by a.position, a.created_at
            limit 1
         )
   where t.id = any(ids);
  return null;
end;
$$;

revoke all on function public.sync_task_lead_assignee() from public, anon;

drop trigger if exists task_assignees_sync_lead on public.task_assignees;
create trigger task_assignees_sync_lead
  after insert or update or delete on public.task_assignees
  for each row execute function public.sync_task_lead_assignee();


-- ─────────────────────────────────────────────────────────────
-- 4. Row level security
--    An assignment is exactly as restricted as the task it is on — a
--    confidential line does not leak through the list of who is on it.
--    Writing is member and above, the same rung that may edit the task
--    itself: putting somebody on a job is editing the job.
-- ─────────────────────────────────────────────────────────────
alter table public.task_assignees enable row level security;

drop policy if exists "read task assignees" on public.task_assignees;
create policy "read task assignees" on public.task_assignees for select to authenticated
  using (public.is_approved() and public.task_visible(task_id));

drop policy if exists "member write task assignees" on public.task_assignees;
create policy "member write task assignees" on public.task_assignees for all to authenticated
  using      (public.has_min_role('member') and public.task_visible(task_id))
  with check (public.has_min_role('member') and public.task_visible(task_id));


-- ─────────────────────────────────────────────────────────────
-- 5. Sanity checks — paste these in afterwards
-- ─────────────────────────────────────────────────────────────
-- Everything that is now on more than one person:
-- select t.title, count(*) as people
--   from public.task_assignees a join public.tasks t on t.id = a.task_id
--  group by t.title having count(*) > 1 order by people desc;

-- The lead column agreeing with the list (should return no rows):
-- select t.id, t.title, t.assignee_id
--   from public.tasks t
--   left join lateral (
--     select a.employee_id from public.task_assignees a
--      where a.task_id = t.id order by a.position, a.created_at limit 1
--   ) lead on true
--  where t.assignee_id is distinct from lead.employee_id;
