-- ============================================================
-- MIGRATION v12 — Documents that point at files on the office NAS
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- The practice keeps every drawing, contract and permit on the office
-- NAS, and every office machine already reaches it over the LAN. So a
-- document row holds an ADDRESS, not a file.
--
-- WHY NOT UPLOAD THEM
--   A copy in cloud storage is a second version of a drawing. The one
--   on the NAS is the one people open, mark up and save, so a copy
--   starts drifting the moment it is made — and for a practice whose
--   deliverable IS the drawing, two versions of A-101 is the failure,
--   not the storage bill. `documents` has always been a pointer table
--   (it has `url` and no bytes); this only teaches it to point at the
--   share as well as at the web.
--
-- WHY THE PATH IS RELATIVE
--   `nas_path` is 'RIY-2024-017/Drawings/A-101.pdf', never
--   '\\NAS01\Projects\RIY-2024-017\Drawings\A-101.pdf'. The share root
--   lives once in app_settings.nas_root. Replacing the NAS, renaming
--   the share, or moving to a second one is then a single edit rather
--   than an update across every row ever added.
--
--   Forward slashes are the stored form. Windows accepts either, and
--   picking one means the value does not depend on which separator the
--   person who typed it happened to use. The UI renders backslashes.
--
-- WHY A CHECK CONSTRAINT ON SOMETHING THE APP ALSO VALIDATES
--   The path is handed to a protocol handler that runs on an office
--   PC. A row reading '../../../Windows/System32' must never reach it.
--   The handler re-checks — it cannot trust the browser either — but a
--   traversal string has no business being stored in the first place,
--   and a constraint is the one check that no future caller can skip.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Where on the NAS this document lives
-- ─────────────────────────────────────────────────────────────
alter table public.documents
  add column if not exists nas_path text;

comment on column public.documents.nas_path is
  'Path relative to app_settings.nas_root, forward slashes. NULL for documents that are a web link instead.';

-- Relative, and no way out of the share. Mirrored in src/lib/nas.js
-- (so the form can explain the problem) and again in the protocol
-- handler (so a bad row cannot act). This copy is the one that holds
-- regardless of which of those is bypassed.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'documents_nas_path_relative'
  ) then
    alter table public.documents add constraint documents_nas_path_relative check (
      nas_path is null
      or (
        length(btrim(nas_path)) > 0
        and nas_path !~ '(^|/)\.\.(/|$)'   -- no parent-directory escape
        and nas_path !~ '^[/\\]'           -- not absolute, not a bare UNC root
        and nas_path !~ '^[A-Za-z]:'       -- not a drive letter
      )
    );
  end if;
end $$;

-- Documents already carry project confidentiality through the policies
-- in migration_v8_confidential.sql, and a path is as restricted as the
-- row holding it. Nothing to add here.
--
-- Worth knowing, and not fixable in SQL: the NAS keeps its own share
-- permissions, and they are not these. A confidential project may point
-- at a folder the whole office can browse. The row will be hidden; the
-- folder will not.


-- ─────────────────────────────────────────────────────────────
-- 2. Settings that belong to the practice, not to a person
--    Key/value because there is one of them today and there will be
--    three eventually, and a column-per-setting table needs a
--    migration every time somebody thinks of the next one.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

-- Empty rather than a guess. The Documents page detects the empty root
-- and says so, which is a better first run than links quietly pointing
-- at a share that was never there.
insert into public.app_settings (key, value)
values ('nas_root', '')
on conflict (key) do nothing;

alter table public.app_settings enable row level security;

-- Everyone approved needs to read the root — it is half of every path
-- the Documents page renders.
drop policy if exists "read app settings" on public.app_settings;
create policy "read app settings" on public.app_settings for select to authenticated
  using (public.is_approved());

-- Changing it repoints every document in the practice at once, which
-- is Principal Architects only. Matches manage_settings in
-- src/lib/constants.js.
drop policy if exists "admin write app settings" on public.app_settings;
create policy "admin write app settings" on public.app_settings for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());


-- ─────────────────────────────────────────────────────────────
-- 3. Done
--    Set the share root in the app: Documents → the gear beside
--    "Add Document". It wants the UNC form, '\\NAS01\Projects', not a
--    mapped drive letter — P: is whatever each machine mapped it to,
--    and half of them mapped something else.
-- ─────────────────────────────────────────────────────────────
