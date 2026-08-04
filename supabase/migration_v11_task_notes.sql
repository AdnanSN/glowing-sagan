-- ============================================================
-- MIGRATION v11 — Notes on a day of a task
-- Run this ONCE in your Supabase SQL Editor.
-- Idempotent: safe to re-run.
-- ============================================================
-- Both timeline charts now open a note panel when a square in the
-- calendar is clicked — Tuesday 30 July on "Design & build tenders",
-- say — and what gets typed there lands here.
--
-- WHY A DAY AND NOT JUST A TASK
--   A line item runs for weeks. "Contractor says the steel is late" is
--   about a Tuesday, not about the whole tender period, and a flat list
--   of comments on the task loses that the moment there are three of
--   them. Keying on (task, day) is what makes the note findable again:
--   the chart draws a marker on the exact square it was written on.
--
--   note_date is deliberately NOT constrained to the task's own dates.
--   Bars move. A note written the day the client changed their mind
--   should stay on that day even after the line is dragged a fortnight
--   later, and a note about a slipped start belongs *before* the bar.
--
-- SCALE
--   A week-per-column chart hands the panel a seven-day range and it
--   reads every note in it; a day-per-column chart hands it one day.
--   Same rows either way — the column width is a view setting, and
--   nothing about how a note is stored should depend on it.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. The table
--    author_name is a snapshot, not a join: employees get archived and
--    profiles get unlinked, and a note in a project record should still
--    say who wrote it a year later. The FK is what draws the avatar
--    while the person is still around.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.task_notes (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,

  -- The square this was written on.
  note_date date not null,

  body text not null,

  author_id   uuid references public.employees(id) on delete set null,
  author_name text,
  -- Ownership for "may I edit this?" — the login rather than the
  -- employee row, so somebody who has not been linked to an employee
  -- can still edit what they just wrote.
  created_by uuid default auth.uid() references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An empty note is a mis-click, not a record.
  constraint task_notes_body_not_blank check (length(btrim(body)) > 0)
);

-- The panel's only query: one task, one day (or one week), oldest first.
create index if not exists task_notes_task_date_idx
  on public.task_notes (task_id, note_date, created_at);

drop trigger if exists task_notes_touch_updated_at on public.task_notes;
create trigger task_notes_touch_updated_at before update on public.task_notes
  for each row execute function public.touch_updated_at();


-- ─────────────────────────────────────────────────────────────
-- 2. Who may see a task
--    A note is exactly as restricted as the line it hangs off, which is
--    not the same as its project: a task carries its own
--    is_confidential. This mirrors the "read tasks" policy in
--    schema.sql clause for clause. Definer, so it can read `tasks`
--    without re-entering that table's policies.
-- ─────────────────────────────────────────────────────────────
create or replace function public.task_visible(p_task uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task
       and (
         public.is_admin()
         or (not t.is_confidential and public.project_visible(t.project_id))
       )
  );
$$;

revoke all on function public.task_visible(uuid) from public, anon;
grant execute on function public.task_visible(uuid) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. Row level security
--    Reading follows the task. Writing is member and above — the same
--    rung that may edit the task itself, since a note is part of how
--    the work is recorded. Editing is your own only, including for
--    admins: rewriting somebody else's note silently is worse than
--    deleting it, which at least leaves a hole. Deleting is your own or
--    a project lead, the same shape as site photos.
-- ─────────────────────────────────────────────────────────────
alter table public.task_notes enable row level security;

drop policy if exists "read task notes" on public.task_notes;
create policy "read task notes" on public.task_notes for select to authenticated
  using (public.is_approved() and public.task_visible(task_id));

drop policy if exists "member add task notes" on public.task_notes;
create policy "member add task notes" on public.task_notes for insert to authenticated
  with check (
    public.has_min_role('member')
    and public.task_visible(task_id)
    -- You may only post as yourself.
    and created_by = auth.uid()
    and (author_id is null or public.owns_employee(author_id))
  );

drop policy if exists "edit own task notes" on public.task_notes;
create policy "edit own task notes" on public.task_notes for update to authenticated
  using      (public.task_visible(task_id) and created_by = auth.uid())
  with check (public.task_visible(task_id) and created_by = auth.uid());

drop policy if exists "delete own task notes" on public.task_notes;
create policy "delete own task notes" on public.task_notes for delete to authenticated
  using (
    public.task_visible(task_id)
    and (public.has_min_role('manager') or created_by = auth.uid())
  );


-- ─────────────────────────────────────────────────────────────
-- 4. Sanity checks — paste these in afterwards
-- ─────────────────────────────────────────────────────────────
-- What has been written, and on which square?
-- select t.title, n.note_date, n.author_name, left(n.body, 60) as note
--   from public.task_notes n
--   join public.tasks t on t.id = n.task_id
--  order by n.note_date desc, n.created_at desc;
--
-- Notes sitting outside the bar they belong to — not wrong (a note can
-- predate a slipped start), but worth a look if there are a lot.
-- select t.title, n.note_date, t.start_date, t.due_date
--   from public.task_notes n
--   join public.tasks t on t.id = n.task_id
--  where t.start_date is not null and t.due_date is not null
--    and (n.note_date < t.start_date or n.note_date > t.due_date);
