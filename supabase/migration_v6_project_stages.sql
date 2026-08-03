-- ============================================================
-- MIGRATION v6 — Per-project stages
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Stages used to be one hard-coded list in the app shared by every
-- project. Now each project carries its own.
--
-- Why a text[] column instead of a stages table:
--   The dashboard works out a progress bar for EVERY project on the
--   page (position of current_stage within the list). With an array
--   that rides along with the existing select('*') for free; with a
--   child table it would be a second query plus a grouping on every
--   load. Stages are a short ordered list that is always read whole
--   and never queried across projects — exactly what an array is for.
--
-- Existing projects: the DEFAULT below backfills every current row
-- with today's seven stages, so nothing visibly changes for them.
-- New projects get the same seven and can edit from there.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The column
--    Adding a column WITH a default fills every existing row, which
--    is exactly the "keep the current stages" behaviour we want.
-- ─────────────────────────────────────────────────────────────
alter table public.projects
  add column if not exists stages text[] not null
    default array[
      'Briefing', 'Schematic Design', 'Design Development',
      'Construction Docs', 'Tender', 'Construction', 'Handover'
    ];

-- A project with zero stages would render an empty pipeline and break
-- the dashboard's progress maths.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_stages_not_empty') then
    alter table public.projects add constraint projects_stages_not_empty
      check (array_length(stages, 1) >= 1);
  end if;
end$$;

-- Belt and braces for rows that predate the column somehow.
update public.projects
   set stages = array[
     'Briefing', 'Schematic Design', 'Design Development',
     'Construction Docs', 'Tender', 'Construction', 'Handover'
   ]
 where stages is null or array_length(stages, 1) is null;


-- ─────────────────────────────────────────────────────────────
-- 2. Saving a new stage list
--    current_stage and tasks.stage both refer to stages BY NAME, so
--    a rename or a delete has to be tidied up in the same breath or
--    they end up pointing at something that no longer exists. Doing
--    it in one function keeps all of that in a single transaction.
--
--    p_renames maps old name -> new name, e.g. {"Tender": "Tender & Award"}
-- ─────────────────────────────────────────────────────────────
create or replace function public.update_project_stages(
  p_project uuid,
  p_stages  text[],
  p_renames jsonb default '{}'::jsonb
)
returns public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project public.projects;
  v_old     text;
  v_new     text;
  v_count   int;
begin
  if not public.has_min_role('manager') then
    raise exception 'Only a project lead or administrator can change stages';
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

  -- Renames first, so the "does it still exist" checks below are
  -- comparing against the new names.
  for v_old, v_new in
    select key, value #>> '{}' from jsonb_each(p_renames)
  loop
    update public.tasks set stage = v_new
     where project_id = p_project and stage = v_old;

    update public.projects set current_stage = v_new
     where id = p_project and current_stage = v_old;
  end loop;

  update public.projects
     set stages = p_stages, updated_at = now()
   where id = p_project
  returning * into v_project;

  if v_project.id is null then
    raise exception 'Project not found';
  end if;

  -- Deleting the stage a project is sitting on must not leave it
  -- pointing at nothing — fall back to the first stage.
  if not (v_project.current_stage = any(p_stages)) then
    update public.projects set current_stage = p_stages[1]
     where id = p_project
    returning * into v_project;
  end if;

  -- A task labelled with a stage this project no longer has would show
  -- a phantom option in the task form. Drop the label, keep the task.
  update public.tasks set stage = null
   where project_id = p_project
     and stage is not null
     and not (stage = any(p_stages));

  return v_project;
end$$;

revoke all on function public.update_project_stages(uuid, text[], jsonb) from public, anon;
grant execute on function public.update_project_stages(uuid, text[], jsonb) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. Sanity check — paste this in afterwards
-- ─────────────────────────────────────────────────────────────
-- select name, current_stage, array_length(stages, 1) as stage_count, stages
-- from public.projects order by name;
--
-- Anything pointing at a stage its project does not have? (should be 0)
-- select count(*) from public.projects where not (current_stage = any(stages));
