-- ============================================================
-- MIGRATION v3 — Profile pictures (avatars)
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Adds:
--   * employees.avatar_url       — public URL of the uploaded image
--   * 'avatars' storage bucket   — public, holds the image files
--   * Storage RLS policies       — anyone authenticated can read,
--                                  admins can upload / replace / delete
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. employees.avatar_url
-- ─────────────────────────────────────────────────────────────
alter table employees add column if not exists avatar_url text;


-- ─────────────────────────────────────────────────────────────
-- 2. Public 'avatars' storage bucket
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;


-- ─────────────────────────────────────────────────────────────
-- 3. Storage RLS policies
--    Read  : any authenticated user
--    Write : admins only (matches employees write policy)
-- ─────────────────────────────────────────────────────────────
drop policy if exists "avatars read"        on storage.objects;
drop policy if exists "avatars admin write" on storage.objects;

create policy "avatars read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars');

create policy "avatars admin write"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'avatars' and public.current_user_role() = 'admin')
  with check (bucket_id = 'avatars' and public.current_user_role() = 'admin');
