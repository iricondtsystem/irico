-- ============================================================================
-- IRICO DICOM portal - Supabase schema
-- Run in the Supabase SQL editor. Requires: storage (bucket) + auth (users).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CLIENTS
-- A client = a company with one protected folder of DICOM studies.
-- Folder path convention in storage:  <client_id>/studies/<study_uid>/...
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- STUDIES
-- One row per uploaded study. metadata holds the OHIF dicomjson studies JSON
-- (study/series/instance tags) WITHOUT per-instance URLs; URLs are generated
-- fresh as short-lived signed URLs at view time.
-- ---------------------------------------------------------------------------
create table if not exists public.studies (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references public.clients(id) on delete cascade,
  study_uid      text not null,
  patient_name   text,
  patient_id     text,
  study_date     text,
  study_time     text,
  study_description text,
  modality       text,
  num_instances  int not null default 0,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (client_id, study_uid)
);

-- ---------------------------------------------------------------------------
-- HELPER: current caller's client_id (from JWT app_metadata), or null.
-- ---------------------------------------------------------------------------
create or replace function public.current_client_id()
returns text language sql stable as $$
  select coalesce(
    auth.jwt() -> 'app_metadata' ->> 'client_id',
    auth.jwt() ->> 'client_id'
  );
$$;

-- ---------------------------------------------------------------------------
-- HELPER: is the caller an admin? (JWT app_metadata.role == 'admin')
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

-- ============================================================================
-- RLS: CLIENTS
-- ============================================================================
alter table public.clients enable row level security;

drop policy if exists "clients_select_all_authenticated" on public.clients;
create policy "clients_select_all_authenticated"
  on public.clients for select to authenticated
  using (true);

drop policy if exists "clients_admin_write" on public.clients;
create policy "clients_admin_write"
  on public.clients for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- RLS: STUDIES
--   - client users: SELECT only their own client's studies
--   - admin: full CRUD
-- ============================================================================
alter table public.studies enable row level security;

drop policy if exists "studies_select_own" on public.studies;
create policy "studies_select_own"
  on public.studies for select to authenticated
  using (public.is_admin() or client_id::text = public.current_client_id());

drop policy if exists "studies_admin_write" on public.studies;
create policy "studies_admin_write"
  on public.studies for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- STORAGE: irico-dicom bucket (PRIVATE)
-- Path layout:
--   <client_id>/studies/<study_uid>/<sop_uid>.dcm
-- Client users can only LIST/READ their own folder. Only admins write.
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'irico-dicom',
  'irico-dicom',
  false,
  524288000, -- 500 MB per file
  array['application/dicom']::text[]
)
on conflict (id) do nothing;

-- client read own folder
drop policy if exists "irico_read_own" on storage.objects;
create policy "irico_read_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'irico-dicom'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = public.current_client_id()
    )
  );

-- client list own folder (listing needs insert-check on objects? no, select covers list)
-- admin write (insert)
drop policy if exists "irico_admin_insert" on storage.objects;
create policy "irico_admin_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'irico-dicom' and public.is_admin());

-- admin update (overwrite)
drop policy if exists "irico_admin_update" on storage.objects;
create policy "irico_admin_update"
  on storage.objects for update to authenticated
  using (bucket_id = 'irico-dicom' and public.is_admin())
  with check (bucket_id = 'irico-dicom' and public.is_admin());

-- admin delete
drop policy if exists "irico_admin_delete" on storage.objects;
create policy "irico_admin_delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'irico-dicom' and public.is_admin());