-- ============================================================
-- MIGRATION v10 — Site photos
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Photos taken on site, filed against the project they belong to.
-- Taken on a phone, standing in the building — so the whole design is
-- shaped by two constraints: a 12 MP camera file must never reach the
-- bucket, and nothing may be readable by anyone the project itself is
-- hidden from.
--
-- WHAT ACTUALLY GETS STORED (see src/lib/photos.js)
--   Two derivatives per photo, both made in the browser:
--     full   2048px on the long edge, WebP q0.82, hard-capped at 700 KB
--            — re-encoded at a lower quality if a busy site shot would
--            have gone over. Enough to zoom into a crack or a rebar
--            spacing, which is the point of a site record.
--     thumb   480px on the long edge, WebP q0.7, ~20–35 KB — the only
--            thing the grid ever downloads.
--   Together ≈ 350–530 KB per photo, so the 1 GB free tier holds
--   roughly 2,000–2,800 of them. The original never leaves the phone.
--
--   The thumbnail is not a nicety: a project with 200 photos would pull
--   ~80 MB per grid view at full size and eat the 5 GB monthly egress in
--   a couple of weeks. At thumbnail size the same view costs ~5 MB, and
--   a full image is fetched only when somebody actually opens one.
--
-- WHY THE BUCKET IS PRIVATE (unlike `avatars`)
--   A confidential project is Principal-Architects-only, and a public
--   bucket would hand out its site photos to anyone holding the URL —
--   and URLs get forwarded. This bucket is private; the app asks for
--   short-lived signed URLs, and the policies below decide who is
--   allowed to be given one. project_visible() is the same function
--   that hides the project itself, so a photo can never outlive the
--   restriction on its project.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The table
--    No is_confidential of its own: a photo is exactly as restricted
--    as the project it was taken on, and nothing else would make sense.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.site_photos (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,

  -- Object keys in the `site-photos` bucket, both under <project_id>/
  -- so one path segment answers "which project is this" for the
  -- storage policies below.
  storage_path text not null unique,
  thumb_path   text not null,

  caption text,
  -- Which stage of the job this records. Free text matching
  -- projects.stages, same as tasks.stage — null means "not filed".
  stage text,
  -- When the camera took it, where the file told us. Falls back to the
  -- upload time in the UI; a photo mailed around for a week should
  -- still sort by when it was shot.
  taken_at timestamptz,

  -- Size and dimensions of the full derivative: the grid reserves the
  -- right box before the image lands, and the quota query at the bottom
  -- of this file has something to add up.
  bytes  int,
  width  int,
  height int,

  uploaded_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The grid always reads one project's photos, newest first.
create index if not exists site_photos_project_taken_idx
  on public.site_photos (project_id, taken_at desc, created_at desc);


-- ─────────────────────────────────────────────────────────────
-- 2. Row level security
--    Read follows the project. Adding is member and above, the same
--    rung as documents. Removing is deliberately narrower: your own
--    upload, or a project lead — a site record is evidence, and one
--    person should not be able to quietly drop somebody else's.
-- ─────────────────────────────────────────────────────────────
alter table public.site_photos enable row level security;

drop policy if exists "read site photos" on public.site_photos;
create policy "read site photos" on public.site_photos for select to authenticated
  using (public.is_approved() and public.project_visible(project_id));

drop policy if exists "member add site photos" on public.site_photos;
create policy "member add site photos" on public.site_photos for insert to authenticated
  with check (public.has_min_role('member') and public.project_visible(project_id));

drop policy if exists "edit own site photos" on public.site_photos;
create policy "edit own site photos" on public.site_photos for update to authenticated
  using (
    public.project_visible(project_id)
    and (public.has_min_role('manager') or public.owns_employee(uploaded_by))
  )
  with check (
    public.project_visible(project_id)
    and (public.has_min_role('manager') or public.owns_employee(uploaded_by))
  );

drop policy if exists "delete own site photos" on public.site_photos;
create policy "delete own site photos" on public.site_photos for delete to authenticated
  using (
    public.project_visible(project_id)
    and (public.has_min_role('manager') or public.owns_employee(uploaded_by))
  );


-- ─────────────────────────────────────────────────────────────
-- 3. The bucket
--    Private, so nothing is served without a signed URL.
--    1.5 MB / image mimes is a backstop against someone bypassing the
--    app and parking a raw camera file in the quota — the client caps
--    itself at 700 KB and only ever sends WebP (JPEG on the older
--    Safari versions that cannot encode WebP).
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-photos', 'site-photos', false, 1572864,
  array['image/webp', 'image/jpeg']
)
on conflict (id) do update set
  public             = false,
  file_size_limit    = 1572864,
  allowed_mime_types = array['image/webp', 'image/jpeg'];


-- ─────────────────────────────────────────────────────────────
-- 4. Storage policies
--    Every object lives at site-photos/<project_id>/<key>, so the first
--    path segment is what the policies key off. try_uuid() (added in
--    v4) turns a malformed path into null rather than an error — and
--    null is refused outright here, because project_visible(null) is
--    true by design and would otherwise wave through anything filed at
--    a nonsense path.
-- ─────────────────────────────────────────────────────────────

create or replace function public.site_photo_project(objname text)
returns uuid
language sql
immutable
set search_path = public
as $$
  select public.try_uuid((storage.foldername(objname))[1]);
$$;

-- Removing an object: a project lead, or the person who uploaded the
-- photo it belongs to. The app deletes the objects BEFORE the row, so
-- the row is still there to be asked. Definer so it can read
-- site_photos without re-entering that table's own policies.
create or replace function public.can_remove_site_photo(objname text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_min_role('manager')
      or exists (
           select 1 from public.site_photos sp
            where (sp.storage_path = objname or sp.thumb_path = objname)
              and public.owns_employee(sp.uploaded_by)
         );
$$;

revoke all on function public.site_photo_project(text)   from public, anon;
revoke all on function public.can_remove_site_photo(text) from public, anon;
grant execute on function public.site_photo_project(text)    to authenticated;
grant execute on function public.can_remove_site_photo(text) to authenticated;

drop policy if exists "read site photo objects" on storage.objects;
create policy "read site photo objects" on storage.objects for select to authenticated
using (
  bucket_id = 'site-photos'
  and public.is_approved()
  and public.site_photo_project(name) is not null
  and public.project_visible(public.site_photo_project(name))
);

drop policy if exists "upload site photo objects" on storage.objects;
create policy "upload site photo objects" on storage.objects for insert to authenticated
with check (
  bucket_id = 'site-photos'
  and public.has_min_role('member')
  and public.site_photo_project(name) is not null
  and public.project_visible(public.site_photo_project(name))
);

drop policy if exists "delete site photo objects" on storage.objects;
create policy "delete site photo objects" on storage.objects for delete to authenticated
using (
  bucket_id = 'site-photos'
  and public.site_photo_project(name) is not null
  and public.project_visible(public.site_photo_project(name))
  and public.can_remove_site_photo(name)
);

-- No update policy on purpose. Every upload gets a fresh key, so an
-- object is written once and never overwritten — which also means a
-- signed URL can be cached for its whole life without ever going stale.


-- ─────────────────────────────────────────────────────────────
-- 5. Sanity checks — paste these in afterwards
-- ─────────────────────────────────────────────────────────────
-- How many photos, and what are they costing?
-- select count(*) as photos,
--        pg_size_pretty(sum((metadata->>'size')::bigint)) as total
--   from storage.objects where bucket_id = 'site-photos';
--
-- Per project, biggest first:
-- select p.name, count(*) as photos,
--        pg_size_pretty(sum(sp.bytes)::bigint) as full_size
--   from public.site_photos sp
--   join public.projects p on p.id = sp.project_id
--  group by p.name order by sum(sp.bytes) desc nulls last;
--
-- Objects with no row left pointing at them (a project deleted while
-- somebody was offline). The app cleans up as it deletes; this is how
-- you would find anything it missed.
-- select o.name
--   from storage.objects o
--   left join public.site_photos sp
--     on sp.storage_path = o.name or sp.thumb_path = o.name
--  where o.bucket_id = 'site-photos' and sp.id is null;
