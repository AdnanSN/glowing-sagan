-- ============================================================
-- MIGRATION v17 — Sub-tasks
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- A main task can now hold sub-tasks: "Presentation - 2" on the
-- Houzing Puzzle 2.0 job, with one sub-task each for the three people
-- doing their part of it. Each sub-task is an ordinary task row — its
-- own people, status, dates and notes — that points at its main task
-- through parent_task_id.
--
-- THE RULES, ENFORCED HERE RATHER THAN TRUSTED TO THE APP
--   One level   A sub-task cannot have sub-tasks, and a task that has
--               sub-tasks cannot itself become one. Project → main
--               task → sub-tasks, and no deeper.
--   Follows     A sub-task always sits in its main task's project and
--               stage. Move the main task and its sub-tasks move with
--               it; the timeline never shows a sub-task stranded in
--               another stage from the line it belongs to.
--   Restricted  A sub-task of a Principal-Architects-only main task is
--               hidden from everyone else too, whatever its own flag
--               says. Its own flag is kept, so un-restricting the main
--               task never quietly un-restricts a sub-task that was
--               marked on purpose.
--   Deleting    Deleting a main task deletes its sub-tasks. They are
--               parts of it, not work in their own right.
--
-- Nothing existing changes: every task already in the table stays a
-- main task until somebody files a sub-task under it.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The link
-- ─────────────────────────────────────────────────────────────
alter table public.tasks
  add column if not exists parent_task_id uuid
    references public.tasks(id) on delete cascade;

-- "The sub-tasks of this task, in order" — the board card, the task
-- dialog and the timeline all ask exactly this.
create index if not exists tasks_parent_position_idx
  on public.tasks (parent_task_id, position);


-- ─────────────────────────────────────────────────────────────
-- 2. One level, and a sub-task follows its main task
--    Definer: the main task may be one the caller cannot see, and the
--    rule has to hold regardless. RLS still decides whether the write
--    is allowed at all — see section 4.
-- ─────────────────────────────────────────────────────────────
create or replace function public.tasks_guard_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_parent public.tasks;
begin
  if new.parent_task_id is null then
    return new;
  end if;
  if new.parent_task_id = new.id then
    raise exception 'A task cannot be a sub-task of itself';
  end if;

  select * into v_parent from public.tasks where id = new.parent_task_id;
  if not found then
    raise exception 'Main task not found';
  end if;
  if v_parent.parent_task_id is not null then
    raise exception 'A sub-task cannot have sub-tasks of its own';
  end if;
  if exists (select 1 from public.tasks where parent_task_id = new.id) then
    raise exception 'This task has sub-tasks of its own, so it cannot become a sub-task';
  end if;

  -- Whatever was sent, a sub-task lives where its main task lives.
  new.project_id := v_parent.project_id;
  new.stage      := v_parent.stage;
  return new;
end$$;

revoke all on function public.tasks_guard_parent() from public, anon;

drop trigger if exists tasks_guard_parent on public.tasks;
create trigger tasks_guard_parent
  before insert or update on public.tasks
  for each row execute function public.tasks_guard_parent();

-- A main task that moves project or stage takes its sub-tasks along.
-- AFTER, so it also tidies up after a multi-row update such as a stage
-- rename, whatever order that update happened to visit the rows in.
create or replace function public.tasks_carry_subtasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_task_id is null
     and (new.project_id is distinct from old.project_id
          or new.stage is distinct from old.stage) then
    update public.tasks
       set project_id = new.project_id, stage = new.stage
     where parent_task_id = new.id
       and (project_id is distinct from new.project_id
            or stage is distinct from new.stage);
  end if;
  return null;
end$$;

revoke all on function public.tasks_carry_subtasks() from public, anon;

drop trigger if exists tasks_carry_subtasks on public.tasks;
create trigger tasks_carry_subtasks
  after update of project_id, stage on public.tasks
  for each row execute function public.tasks_carry_subtasks();


-- ─────────────────────────────────────────────────────────────
-- 3. Is the main task restricted?
--    Definer so the tasks policies below can ask without re-entering
--    their own table's RLS — the same pattern folder_is_confidential()
--    uses for project_folders.
-- ─────────────────────────────────────────────────────────────
create or replace function public.task_parent_restricted(p_parent uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select t.is_confidential from public.tasks t where t.id = p_parent), false);
$$;

revoke all on function public.task_parent_restricted(uuid) from public, anon;
grant execute on function public.task_parent_restricted(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. Task policies — restricted on their own, by their project, or
--    now by their main task.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read tasks" on public.tasks;
create policy "read tasks" on public.tasks for select to authenticated
  using (
    public.is_approved() and (
      public.is_admin()
      or (
        not is_confidential
        and (parent_task_id is null or not public.task_parent_restricted(parent_task_id))
        and public.project_visible(project_id)
      )
    )
  );

drop policy if exists "member write tasks" on public.tasks;
create policy "member write tasks" on public.tasks for all to authenticated
  using (
    public.has_min_role('member') and (
      public.is_admin()
      or (
        not is_confidential
        and (parent_task_id is null or not public.task_parent_restricted(parent_task_id))
        and public.project_visible(project_id)
      )
    )
  )
  with check (
    public.has_min_role('member') and (
      public.is_admin()
      or (
        not is_confidential
        and (parent_task_id is null or not public.task_parent_restricted(parent_task_id))
        and public.project_visible(project_id)
      )
    )
  );

-- Notes and assignments follow task_visible(), so it has to agree with
-- the policy above clause for clause.
create or replace function public.task_visible(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task
       and (
         public.is_admin()
         or (
           not t.is_confidential
           and not exists (
             select 1 from public.tasks p
              where p.id = t.parent_task_id and p.is_confidential
           )
           and public.project_visible(t.project_id)
         )
       )
  );
$$;

revoke all on function public.task_visible(uuid) from public, anon;
grant execute on function public.task_visible(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. Sanity checks — paste these in afterwards
-- ─────────────────────────────────────────────────────────────
-- Tasks have to belong to a project from now on (the app no longer
-- offers "No project"). Any that do not still show on the all-projects
-- board; this is how many there are:
-- select count(*) from public.tasks where project_id is null;

-- Every main task with its sub-tasks:
-- select m.title as main_task, s.title as sub_task, s.status
--   from public.tasks s join public.tasks m on m.id = s.parent_task_id
--  order by m.title, s.position;

-- A sub-task in a different project or stage from its main task
-- (should return no rows):
-- select s.id, s.title
--   from public.tasks s join public.tasks m on m.id = s.parent_task_id
--  where s.project_id is distinct from m.project_id
--     or s.stage is distinct from m.stage;
