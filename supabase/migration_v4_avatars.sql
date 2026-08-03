-- ============================================================
-- MIGRATION v4 — Profile photos
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Why it is built this way (free tier — 1 GB storage, 5 GB egress):
--
--   * The photo hangs off `employees`, not `profiles`. Tasks are
--     assigned to an employee, so putting the picture there makes it
--     show up on every surface that already renders that row —
--     assignee chips, the Team page, the dashboard, the sidebar —
--     without a second lookup anywhere.
--
--   * ONE storage object per person, at the fixed path
--       avatars/<employee_id>/avatar
--     uploaded with upsert. Re-uploading replaces the file in place,
--     so storage is bounded by headcount, not by how often people
--     change their picture.
--
--   * The browser downscales to a 256px WebP square before uploading
--     (see src/lib/avatar.js), so each object is ~5–10 KB. The bucket
--     limit below is a backstop, not the normal case.
--
--   * The bucket is public and served through the CDN with a one-year
--     cache header; the app stores the URL with a ?v= stamp so a new
--     photo busts the cache without ever needing a short TTL.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The column
-- ─────────────────────────────────────────────────────────────
alter table public.employees
  add column if not exists avatar_url text;


-- ─────────────────────────────────────────────────────────────
-- 2. Helpers used by the storage policies
-- ─────────────────────────────────────────────────────────────

-- The first path segment is an employee id, but a malformed upload
-- path must fail the policy rather than raise a cast error.
create or replace function public.try_uuid(t text)
returns uuid
language plpgsql
immutable
as $$
begin
  return t::uuid;
exception when others then
  return null;
end$$;

-- SECURITY DEFINER so it can read `employees` without tripping that
-- table's own RLS.
create or replace function public.owns_employee(emp uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select emp is not null and exists (
    select 1 from public.employees
     where id = emp and auth_user_id = auth.uid()
  );
$$;


-- ─────────────────────────────────────────────────────────────
-- 3. The bucket
--    512 KB / image mime types is a backstop: the client already
--    ships ~5–10 KB WebP. It stops someone bypassing the app and
--    parking a 40 MB raw file in your quota.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 524288,
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public             = true,
  file_size_limit    = 524288,
  allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];


-- ─────────────────────────────────────────────────────────────
-- 4. Storage policies
--    Read is open (that is what "public bucket" means and it is why
--    the CDN can cache). Writes are limited to your own folder, or
--    to anyone's folder if you are an admin — admins need to be able
--    to set a picture for a colleague who has no login yet.
-- ─────────────────────────────────────────────────────────────
drop policy if exists "avatars are publicly readable" on storage.objects;
create policy "avatars are publicly readable" on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "upload own avatar" on storage.objects;
create policy "upload own avatar" on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (
    public.is_admin()
    or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))
  )
);

drop policy if exists "replace own avatar" on storage.objects;
create policy "replace own avatar" on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (
    public.is_admin()
    or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))
  )
)
with check (
  bucket_id = 'avatars'
  and (
    public.is_admin()
    or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))
  )
);

drop policy if exists "delete own avatar" on storage.objects;
create policy "delete own avatar" on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (
    public.is_admin()
    or public.owns_employee(public.try_uuid((storage.foldername(name))[1]))
  )
);


-- ─────────────────────────────────────────────────────────────
-- 5. Writing the URL back
--    `employees` is admin-write only, so an ordinary user cannot
--    update their own row directly. This definer function is the one
--    hole in that wall and it is a narrow one: it only ever touches
--    avatar_url, only on the row linked to the caller's login.
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_my_avatar(p_url text)
returns public.employees
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_emp public.employees;
begin
  if not public.is_approved() then
    raise exception 'Your account has not been approved yet';
  end if;

  -- Only an image we host. Without this a user could point their
  -- avatar at any external URL, which then loads in every teammate's
  -- browser — a tracking pixel with extra steps.
  if v_url is not null
     and v_url !~ '^https://[A-Za-z0-9.-]+/storage/v1/object/public/avatars/' then
    raise exception 'Avatar must be an uploaded image';
  end if;

  update public.employees
     set avatar_url = v_url
   where auth_user_id = auth.uid()
  returning * into v_emp;

  if v_emp.id is null then
    raise exception 'Your login is not linked to a team member yet — ask an administrator to link it on the Access page';
  end if;

  return v_emp;
end$$;

revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6. Sanity check — paste this in afterwards
-- ─────────────────────────────────────────────────────────────
-- select name, role, avatar_url is not null as has_photo
-- from public.employees order by name;
--
-- How much of the quota is this actually using?
-- select count(*) as photos, pg_size_pretty(sum((metadata->>'size')::bigint)) as total
-- from storage.objects where bucket_id = 'avatars';
