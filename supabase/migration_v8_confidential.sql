-- ============================================================
-- MIGRATION v8 — Principal-Architects-only folders, projects, tasks
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Internal office work should be invisible to the rest of the
-- practice — not "hidden in the UI", actually unreadable. So the
-- rule lives in row level security: a restricted row is never sent
-- to a non-admin client at all, whichever page asks for it, and the
-- same is true of anything hanging off it (tasks, milestones,
-- documents, comments).
--
-- Admin is the Principal Architect role in the app's own wording.
--
-- Three flags, because the practice files things three ways:
--   project_folders.is_confidential — the whole drawer, and every
--     project filed in it, no matter how those projects are flagged.
--   projects.is_confidential — one project and all its contents.
--   tasks.is_confidential — a single task inside an otherwise
--     ordinary project.
--
-- Only an admin can set any of them, or touch a row that already
-- carries one. A manager cannot flag a project (which would hide it
-- from themselves), unflag one, or file a project into a restricted
-- folder — the WITH CHECK clauses below refuse all three.
--
-- Nothing changes for existing rows: every flag defaults to false.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The flags
-- ─────────────────────────────────────────────────────────────
alter table public.project_folders
  add column if not exists is_confidential boolean not null default false;

alter table public.projects
  add column if not exists is_confidential boolean not null default false;

alter table public.tasks
  add column if not exists is_confidential boolean not null default false;


-- ─────────────────────────────────────────────────────────────
-- 2. Visibility helpers
--    SECURITY DEFINER so they can read the parent rows without
--    re-entering the very policies that call them.
-- ─────────────────────────────────────────────────────────────

-- Does this folder restrict everything filed in it? A project with
-- no folder (Unfiled) is not restricted by association.
create or replace function public.folder_is_confidential(p_folder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select f.is_confidential from public.project_folders f where f.id = p_folder),
    false
  );
$$;

-- May the current user see this project — and therefore anything
-- that belongs to it? A row whose project_id is null (not attached
-- to any project) is left alone.
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


-- ─────────────────────────────────────────────────────────────
-- 3. Policies
--    Same shape as before — an approved account reads, the role
--    ladder writes — with the restriction test added to both.
-- ─────────────────────────────────────────────────────────────

-- FOLDERS
drop policy if exists "read project folders" on public.project_folders;
create policy "read project folders" on public.project_folders for select to authenticated
  using (public.is_approved() and (public.is_admin() or not is_confidential));

drop policy if exists "manager write project folders" on public.project_folders;
create policy "manager write project folders" on public.project_folders for all to authenticated
  using       (public.has_min_role('manager') and (public.is_admin() or not is_confidential))
  with check  (public.has_min_role('manager') and (public.is_admin() or not is_confidential));

-- PROJECTS — restricted in their own right, or by the folder they sit in
drop policy if exists "read projects" on public.projects;
create policy "read projects" on public.projects for select to authenticated
  using (
    public.is_approved() and (
      public.is_admin()
      or (not is_confidential and not public.folder_is_confidential(folder_id))
    )
  );

drop policy if exists "manager write projects" on public.projects;
create policy "manager write projects" on public.projects for all to authenticated
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

-- TASKS — a task can be restricted on its own, or by its project
drop policy if exists "read tasks" on public.tasks;
create policy "read tasks" on public.tasks for select to authenticated
  using (
    public.is_approved() and (
      public.is_admin()
      or (not is_confidential and public.project_visible(project_id))
    )
  );

drop policy if exists "member write tasks" on public.tasks;
create policy "member write tasks" on public.tasks for all to authenticated
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

-- MILESTONES — follow their project
drop policy if exists "read milestones" on public.milestones;
create policy "read milestones" on public.milestones for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));

drop policy if exists "manager write milestones" on public.milestones;
create policy "manager write milestones" on public.milestones for all to authenticated
  using      (public.has_min_role('manager') and public.project_visible(project_id))
  with check (public.has_min_role('manager') and public.project_visible(project_id));

-- DOCUMENTS — follow their project
drop policy if exists "read documents" on public.documents;
create policy "read documents" on public.documents for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));

drop policy if exists "member write documents" on public.documents;
create policy "member write documents" on public.documents for all to authenticated
  using      (public.has_min_role('member') and public.project_visible(project_id))
  with check (public.has_min_role('member') and public.project_visible(project_id));

-- COMMENTS — follow their project
drop policy if exists "read comments" on public.comments;
create policy "read comments" on public.comments for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));

drop policy if exists "member insert comments" on public.comments;
create policy "member insert comments" on public.comments for insert to authenticated
  with check (public.has_min_role('member') and public.project_visible(project_id));

-- (admins moderate everything; "admin manage comments" is unchanged)


-- ─────────────────────────────────────────────────────────────
-- 4. Close the back door in update_project_stages()
--    It is SECURITY DEFINER, so RLS does not apply inside it — a
--    manager who guessed a restricted project's id could otherwise
--    rewrite its stages and read the returned row. Same wording as
--    a genuinely missing id, so it does not confirm what exists.
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


-- ─────────────────────────────────────────────────────────────
-- 5. Sanity checks — paste these in afterwards
-- ─────────────────────────────────────────────────────────────
-- What is restricted right now (expect nothing until you flag some):
-- select 'folder' as kind, name, is_confidential from public.project_folders where is_confidential
-- union all
-- select 'project', name, is_confidential from public.projects where is_confidential
-- union all
-- select 'task', title, is_confidential from public.tasks where is_confidential;
--
-- Every project a NON-admin should be able to see (run as yourself to
-- compare — an admin sees all of them):
-- select p.name, p.is_confidential, f.name as folder, f.is_confidential as folder_restricted
--   from public.projects p
--   left join public.project_folders f on f.id = p.folder_id
--  order by p.name;
