-- ============================================================
-- MIGRATION v7 — Drop projects.budget
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- The practice does not track budgets in here, so the column and
-- everything that read it are gone from the app.
--
-- THIS DELETES DATA. Every budget figure currently stored on a
-- project goes with the column, and there is no undo. If any of
-- them are worth keeping, take a copy FIRST:
--
--   select id, name, client, budget
--     from public.projects
--    where budget is not null;
--
-- Run the app's new build before this, not after: the old build
-- writes budget on every project save and would fail once the
-- column is gone.
-- ============================================================

alter table public.projects
  drop column if exists budget;


-- ─────────────────────────────────────────────────────────────
-- Sanity check — paste this in afterwards. Expect zero rows.
-- ─────────────────────────────────────────────────────────────
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'projects'
--    and column_name = 'budget';
