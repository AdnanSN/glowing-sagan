-- ============================================================
-- MIGRATION v16 — Folders inside folders
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- The practice's NAS is a tree — 00-ADMIN holds Accounts, DSM, HR,
-- MISCELLANEOUS — and a flat row of folders cannot mirror it. Each
-- folder now has an optional parent; null means it sits at the top.
--
-- WHAT CHANGES WITH NESTING
--   Names       unique among siblings only, so every client folder can
--               have its own "Drawings" — exactly as on the NAS.
--   Restriction a restricted folder hides everything below it, however
--               deep. folder_is_confidential() now walks up the tree,
--               so every policy that already calls it (projects, tasks,
--               milestones, documents, comments) inherits for free.
--   Deleting    still never deletes a project. A deleted folder's
--               subfolders and projects move up one level, into its
--               parent — or to the top / Unfiled if it had none.
--   Loops       a folder cannot be moved inside itself or any of its
--               own subfolders; the trigger below refuses it.
--
-- Nothing moves on its own: every existing folder stays at the top
-- until you file it somewhere.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The link
--    SET NULL is only a backstop — the delete trigger in section 4
--    re-parents children before the row goes.
-- ─────────────────────────────────────────────────────────────
alter table public.project_folders
  add column if not exists parent_id uuid
    references public.project_folders(id) on delete set null;

create index if not exists project_folders_parent_idx
  on public.project_folders (parent_id);


-- ─────────────────────────────────────────────────────────────
-- 2. Names are unique per parent, not across the whole cabinet.
--    The top level counts as one parent (the all-zero uuid).
-- ─────────────────────────────────────────────────────────────
drop index if exists public.project_folders_name_unique;
create unique index if not exists project_folders_sibling_name_unique
  on public.project_folders (
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );


-- ─────────────────────────────────────────────────────────────
-- 3. Restriction is inherited from any folder above.
--    The depth cap is a second line of defence against a loop the
--    guard in section 4 should already make impossible.
-- ─────────────────────────────────────────────────────────────
create or replace function public.folder_is_confidential(p_folder uuid)
returns boolean language sql stable security definer set search_path = public as $$
  with recursive chain as (
    select f.id, f.parent_id, f.is_confidential, 1 as depth
      from public.project_folders f where f.id = p_folder
    union all
    select f.id, f.parent_id, f.is_confidential, c.depth + 1
      from public.project_folders f
      join chain c on f.id = c.parent_id
     where c.depth < 64
  )
  select coalesce(bool_or(is_confidential), false) from chain;
$$;

revoke all on function public.folder_is_confidential(uuid) from public, anon;
grant execute on function public.folder_is_confidential(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 4. Triggers
--    Both definer: they must see restricted folders a manager cannot,
--    or a hidden subfolder could be orphaned or looped around.
-- ─────────────────────────────────────────────────────────────

-- No folder inside itself, directly or through its own subfolders.
create or replace function public.project_folders_guard_parent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'A folder cannot be inside itself';
  end if;
  if exists (
    with recursive up as (
      select f.id, f.parent_id from public.project_folders f where f.id = new.parent_id
      union
      select f.id, f.parent_id from public.project_folders f join up on f.id = up.parent_id
    )
    select 1 from up where up.id = new.id
  ) then
    raise exception 'A folder cannot be moved inside one of its own subfolders';
  end if;
  return new;
end$$;

revoke all on function public.project_folders_guard_parent() from public, anon;

drop trigger if exists project_folders_guard_parent on public.project_folders;
create trigger project_folders_guard_parent
  before insert or update of parent_id on public.project_folders
  for each row execute function public.project_folders_guard_parent();

-- Deleting a folder empties it into its parent first. Moving up a
-- level can only ever lose a restriction the deleted folder set on
-- itself — and only an admin can delete a restricted folder.
create or replace function public.project_folders_reparent_on_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.project_folders set parent_id = old.parent_id where parent_id = old.id;
  update public.projects        set folder_id = old.parent_id where folder_id = old.id;
  return old;
end$$;

revoke all on function public.project_folders_reparent_on_delete() from public, anon;

drop trigger if exists project_folders_reparent_on_delete on public.project_folders;
create trigger project_folders_reparent_on_delete
  before delete on public.project_folders
  for each row execute function public.project_folders_reparent_on_delete();


-- ─────────────────────────────────────────────────────────────
-- 5. Folder policies — test the whole chain, not just the row.
--    USING checks the folder as it stands (itself and everything
--    above it). WITH CHECK checks the new row's own flag and its new
--    parent, so a manager can neither flag a folder nor move one into
--    — or out of — restricted territory.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read project folders" on public.project_folders;
create policy "read project folders" on public.project_folders for select to authenticated
  using (public.is_approved() and (public.is_admin() or not public.folder_is_confidential(id)));

drop policy if exists "manager write project folders" on public.project_folders;
create policy "manager write project folders" on public.project_folders for all to authenticated
  using (
    public.has_min_role('manager')
    and (public.is_admin() or not public.folder_is_confidential(id))
  )
  with check (
    public.has_min_role('manager')
    and (public.is_admin() or (not is_confidential and not public.folder_is_confidential(parent_id)))
  );


-- ─────────────────────────────────────────────────────────────
-- 6. Sanity check — paste this in afterwards
-- ─────────────────────────────────────────────────────────────
-- with recursive tree as (
--   select id, name, parent_id, name::text as path from public.project_folders where parent_id is null
--   union all
--   select f.id, f.name, f.parent_id, t.path || ' / ' || f.name
--     from public.project_folders f join tree t on f.parent_id = t.id
-- )
-- select path, public.folder_is_confidential(id) as restricted from tree order by path;
