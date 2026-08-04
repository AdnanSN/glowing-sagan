-- ============================================================
-- MIGRATION v9 — Timeline (Gantt) support
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- The single Gantt page is now two charts, because they answer two
-- different questions and were fighting each other in one grid:
--
--   • Project Timeline — one project, drawn stage by stage from
--     kick-off to handover, the way the practice's timeline
--     spreadsheet has always been laid out.
--   • Team Schedule — who is working on what, and when it is due.
--
-- Between them they needed three things the schema did not carry.
--
--   tasks.progress  Per cent complete. A status alone cannot say a
--                   drawing set is 60% done, and the spreadsheet this
--                   chart replaces has a PROGRESS column on every line.
--                   Kept separate from status rather than derived from
--                   it: "In Progress" covers everything from 5% to 95%.
--
--   tasks.position  The order line items sit in under their stage, so
--                   1.1 / 1.2 / 1.3 stay where they were put instead of
--                   re-sorting themselves by created_at every time a
--                   line is added in the middle.
--
--   projects.project_number / revision
--                   The two header fields on the timeline sheet that
--                   had nowhere to live.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The columns
-- ─────────────────────────────────────────────────────────────
alter table public.tasks
  add column if not exists progress smallint not null default 0,
  add column if not exists position int      not null default 0;

-- smallint on its own would happily store 4000% complete.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_progress_range') then
    alter table public.tasks add constraint tasks_progress_range
      check (progress between 0 and 100);
  end if;
end$$;

alter table public.projects
  add column if not exists project_number text,
  add column if not exists revision       text;


-- ─────────────────────────────────────────────────────────────
-- 2. Backfill
--    Existing rows have only a status to go on. These are the exact
--    figures the old chart drew its part-filled bars with, so the
--    first load of the new chart shows what the old one did.
--
--    `where progress = 0` so re-running this never overwrites a
--    percentage somebody has since typed in.
-- ─────────────────────────────────────────────────────────────
update public.tasks
   set progress = case status
                    when 'Done'        then 100
                    when 'In Review'   then 85
                    when 'In Progress' then 50
                    else 0
                  end
 where progress = 0
   and status <> 'To Do';

-- Seed the order from the order things were created in, per project
-- and stage — i.e. exactly the order the list is in today.
with ranked as (
  select id,
         row_number() over (
           partition by project_id, coalesce(stage, '')
           order by created_at, id
         ) as rn
    from public.tasks
)
update public.tasks t
   set position = ranked.rn
  from ranked
 where ranked.id = t.id
   and t.position = 0;


-- ─────────────────────────────────────────────────────────────
-- 3. Index
--    The project chart reads one project's lines whole and renders
--    them grouped by stage in position order — this is that query.
-- ─────────────────────────────────────────────────────────────
create index if not exists tasks_project_stage_position_idx
  on public.tasks (project_id, stage, position);


-- ─────────────────────────────────────────────────────────────
-- 4. Sanity check — paste this in afterwards
-- ─────────────────────────────────────────────────────────────
-- select title, stage, position, progress, start_date, due_date
--   from public.tasks order by project_id, stage, position;
--
-- Anything outside 0–100? (should be 0)
-- select count(*) from public.tasks where progress not between 0 and 100;
