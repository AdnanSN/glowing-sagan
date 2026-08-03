-- ============================================================
-- MIGRATION v5 — Project folders
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Folders are a filing cabinet, deliberately separate from
-- projects.status:
--
--   status  is what the project IS  (Active, Paused, Completed…)
--   folder  is where you FILED it   (renameable, yours to invent)
--
-- Keeping them apart means you can rename "Ongoing" to "2026 Builds"
-- without touching a single project's status, and a project can sit in
-- any folder regardless of its state. Section 4 seeds the folders from
-- status once, as a starting point — after that they drift apart and
-- that is the point.
--
-- Deleting a folder never deletes projects: folder_id is
-- ON DELETE SET NULL, so its contents fall back to "Unfiled".
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The folders
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  position   int  not null default 0,   -- display order; ties break on name
  created_at timestamptz not null default now()
);

-- Two folders called "Ongoing" would be a filing system that lies.
-- Case-insensitive so "ongoing" cannot sneak past it either.
create unique index if not exists project_folders_name_unique
  on public.project_folders (lower(name));


-- ─────────────────────────────────────────────────────────────
-- 2. The link
-- ─────────────────────────────────────────────────────────────
alter table public.projects
  add column if not exists folder_id uuid
    references public.project_folders(id) on delete set null;

create index if not exists projects_folder_idx on public.projects (folder_id);


-- ─────────────────────────────────────────────────────────────
-- 3. RLS — same ladder as projects themselves:
--    everyone approved reads, managers and above reorganise.
-- ─────────────────────────────────────────────────────────────
alter table public.project_folders enable row level security;

drop policy if exists "read project folders"          on public.project_folders;
drop policy if exists "manager write project folders" on public.project_folders;

create policy "read project folders" on public.project_folders
  for select to authenticated
  using (public.is_approved());

create policy "manager write project folders" on public.project_folders
  for all to authenticated
  using (public.has_min_role('manager'))
  with check (public.has_min_role('manager'));


-- ─────────────────────────────────────────────────────────────
-- 4. Seed the three starting folders, and file what already exists
--    so the page isn't one giant "Unfiled" pile on first open.
--    Guarded on emptiness: re-running never resurrects a folder you
--    deleted, and never re-files a project you have since moved.
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_ongoing uuid;
  v_hold    uuid;
  v_done    uuid;
begin
  if exists (select 1 from public.project_folders) then
    raise notice 'Folders already exist — leaving them alone.';
    return;
  end if;

  insert into public.project_folders (name, position) values
    ('Ongoing', 1), ('On Hold', 2), ('Completed', 3);

  select id into v_ongoing from public.project_folders where name = 'Ongoing';
  select id into v_hold    from public.project_folders where name = 'On Hold';
  select id into v_done    from public.project_folders where name = 'Completed';

  -- A first pass only. Move anything that lands wrong from the app.
  update public.projects set folder_id = case status
    when 'Active'    then v_ongoing
    when 'Planning'  then v_ongoing
    when 'Paused'    then v_hold
    when 'Completed' then v_done
    when 'Cancelled' then v_done
    else v_ongoing
  end
  where folder_id is null;
end$$;


-- ─────────────────────────────────────────────────────────────
-- 5. Sanity check — paste this in afterwards
-- ─────────────────────────────────────────────────────────────
-- select coalesce(f.name, '(unfiled)') as folder, count(p.id) as projects
-- from public.projects p
-- left join public.project_folders f on f.id = p.folder_id
-- group by 1 order by 1;
