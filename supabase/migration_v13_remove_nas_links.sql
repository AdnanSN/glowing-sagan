-- ============================================================
-- MIGRATION v13 - Undo the NAS link columns from v12
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run, and safe to run even if
-- migration_v12_nas_links.sql was never applied.
-- ============================================================
-- v12 stored a path relative to a shared NAS root, so a document could
-- point at a file on the office network. Opening one of those needed a
-- small program registered on every office PC, because a browser will
-- not follow a network path from a web page. That is undeployable for
-- a practice where nobody is technical and whoever maintains the
-- system is not in the building, so the whole idea is withdrawn.
--
-- A document is back to being what it always was here: a name, a
-- location, and some notes. `documents.url` holds the location - a
-- network path or a web link, whichever the practice pastes in - and
-- the app shows it to be copied. Nothing is uploaded and nothing is
-- stored.
--
-- WHY THE v12 FILE IS STILL IN THE REPO
--   Because it may already have been run against the live database,
--   and deleting the file would not undo that. Migrations are a record
--   of what happened, so the reversal is a new step rather than an
--   edit to history.
--
-- NOTHING HERE TOUCHES DOCUMENT DATA
--   Only the columns v12 added are removed. name, url, doc_type,
--   project_id, uploaded_by, notes and every existing row are
--   untouched.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The nas_path column and the things attached to it
--    Dropped in order: the check constraint, then the column. The
--    column held no data - the feature never reached the point of
--    being used - so this loses nothing.
-- ─────────────────────────────────────────────────────────────
alter table public.documents
  drop constraint if exists documents_nas_path_relative;

alter table public.documents
  drop column if exists nas_path;


-- ─────────────────────────────────────────────────────────────
-- 2. The practice-wide settings table
--    Created in v12 solely to hold the NAS share root, and nothing
--    else ever used it.
--
--    If you would rather keep a general settings table for later,
--    comment out this section: an empty table costs nothing, and the
--    app no longer reads it either way.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "read app settings"        on public.app_settings;
drop policy if exists "admin write app settings" on public.app_settings;

drop table if exists public.app_settings;


-- ─────────────────────────────────────────────────────────────
-- 3. Sanity checks - paste these in afterwards
-- ─────────────────────────────────────────────────────────────
-- nas_path is gone and the real columns are still there:
--   select column_name
--     from information_schema.columns
--    where table_schema = 'public' and table_name = 'documents'
--    order by column_name;
--   -- expect exactly: created_at, doc_type, id, name, notes,
--   --                 project_id, uploaded_by, url
--
-- The settings table is gone:
--   select to_regclass('public.app_settings');   -- expect NULL
--
-- Documents survived:
--   select count(*) from public.documents;
