-- Prescription Vault on D1 (SQLite). Port of supabase/migrations/*.sql.
-- No RLS here: the Worker (src/index.ts) is the only client and enforces access in code.
-- user ids are Supabase Auth user ids (auth stays on Supabase); there is no users table.

create table profiles (
  id           text primary key,
  user_id      text unique,
  manager_id   text,
  display_name text not null check (length(display_name) between 1 and 80),
  relation     text check (length(relation) <= 40),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((user_id is null) <> (manager_id is null))
);
create index profiles_manager_idx on profiles(manager_id);

create table documents (
  id          text primary key,
  profile_id  text not null references profiles(id) on delete cascade,
  type        text not null check (type in ('prescription', 'report')),
  doc_date    text not null default (date('now')),
  title       text check (length(title) <= 120),
  doctor      text check (length(doctor) <= 80),
  specialty   text check (length(specialty) <= 60),
  hospital    text check (length(hospital) <= 80),
  page_count  integer not null default 0 check (page_count >= 0),
  created_by  text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
create index documents_profile_date_idx on documents(profile_id, doc_date desc, created_at desc);

create table document_pages (
  id           text primary key,
  document_id  text not null references documents(id) on delete cascade,
  page_no      integer not null check (page_no >= 1),
  storage_path text not null unique,
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes   integer check (size_bytes >= 0),
  created_at   text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (document_id, page_no)
);

create table access_grants (
  id          text primary key,
  viewer_id   text not null,
  profile_id  text not null references profiles(id) on delete cascade,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (viewer_id, profile_id)
);
create index access_grants_profile_idx on access_grants(profile_id);

create table invites (
  id          text primary key,
  token       text not null unique,
  from_user   text not null,
  purpose     text not null check (purpose in ('view', 'claim')),
  profile_id  text references profiles(id) on delete cascade,
  expires_at  text not null,
  used_at     text,
  used_by     text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  check ((purpose = 'claim') = (profile_id is not null))
);

create trigger document_pages_count_ins after insert on document_pages begin
  update documents set page_count = (select count(*) from document_pages where document_id = new.document_id)
  where id = new.document_id;
end;
create trigger document_pages_count_del after delete on document_pages begin
  update documents set page_count = (select count(*) from document_pages where document_id = old.document_id)
  where id = old.document_id;
end;
