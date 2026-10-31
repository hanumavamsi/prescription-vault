-- Prescription Vault: core schema, access rules, RPCs.
-- Access model:
--   * Every auth user gets one "own" profile (profiles.user_id = auth.uid()).
--   * A user can create "managed" profiles (profiles.manager_id = auth.uid()) for people without the app.
--   * access_grants give a viewer read-only access to another user's own profile, after that user approves an invite.
--   * Editors of a profile = its user or its manager. Viewers = editors + active grantees.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid unique references auth.users(id) on delete cascade,
  manager_id   uuid references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  relation     text check (char_length(relation) <= 40),
  created_at   timestamptz not null default now(),
  constraint profiles_one_owner check ((user_id is null) <> (manager_id is null))
);
create index profiles_manager_idx on public.profiles(manager_id);

create table public.documents (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  type        text not null check (type in ('prescription', 'report')),
  doc_date    date not null default current_date,
  title       text check (char_length(title) <= 120),
  page_count  int  not null default 0 check (page_count >= 0),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index documents_profile_date_idx on public.documents(profile_id, doc_date desc, created_at desc);

create table public.document_pages (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  page_no      int  not null check (page_no >= 1),
  storage_path text not null unique,
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes   int  check (size_bytes >= 0),
  created_at   timestamptz not null default now(),
  unique (document_id, page_no)
);

create table public.access_grants (
  id          uuid primary key default gen_random_uuid(),
  viewer_id   uuid not null references auth.users(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (viewer_id, profile_id)
);
create index access_grants_profile_idx on public.access_grants(profile_id);

create table public.invites (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique default encode(gen_random_bytes(18), 'hex'),
  from_user   uuid not null references auth.users(id) on delete cascade,
  purpose     text not null check (purpose in ('view', 'claim')),
  profile_id  uuid references public.profiles(id) on delete cascade,
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  used_by     uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint invites_claim_has_profile check ((purpose = 'claim') = (profile_id is not null))
);

-- ---------------------------------------------------------------- access helpers

create or replace function public.can_edit_profile(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    where p.id = pid and (p.user_id = auth.uid() or p.manager_id = auth.uid())
  );
$$;

create or replace function public.can_view_profile(pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_profile(pid) or exists (
    select 1 from access_grants g where g.profile_id = pid and g.viewer_id = auth.uid()
  );
$$;

-- Display names of people who can view my records are visible to me.
create or replace function public.is_my_viewer(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from access_grants g join profiles p on p.id = g.profile_id
    where g.viewer_id = uid and p.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------- RLS

alter table public.profiles       enable row level security;
alter table public.documents      enable row level security;
alter table public.document_pages enable row level security;
alter table public.access_grants  enable row level security;
alter table public.invites        enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  -- Ownership is checked inline: helper functions can't see a row inside its own INSERT ... RETURNING.
  using (user_id = auth.uid() or manager_id = auth.uid() or public.can_view_profile(id)
         or (user_id is not null and public.is_my_viewer(user_id)));
create policy profiles_insert_managed on public.profiles for insert to authenticated
  with check (manager_id = auth.uid() and user_id is null);
create policy profiles_update on public.profiles for update to authenticated
  using (public.can_edit_profile(id))
  with check (public.can_edit_profile(id));
create policy profiles_delete_managed on public.profiles for delete to authenticated
  using (manager_id = auth.uid());

create policy documents_select on public.documents for select to authenticated
  using (public.can_view_profile(profile_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_edit_profile(profile_id) and created_by = auth.uid());
create policy documents_update on public.documents for update to authenticated
  using (public.can_edit_profile(profile_id))
  with check (public.can_edit_profile(profile_id));
create policy documents_delete on public.documents for delete to authenticated
  using (public.can_edit_profile(profile_id));

create policy pages_select on public.document_pages for select to authenticated
  using (exists (select 1 from documents d where d.id = document_id and public.can_view_profile(d.profile_id)));
create policy pages_insert on public.document_pages for insert to authenticated
  with check (exists (select 1 from documents d where d.id = document_id and public.can_edit_profile(d.profile_id)));
create policy pages_delete on public.document_pages for delete to authenticated
  using (exists (select 1 from documents d where d.id = document_id and public.can_edit_profile(d.profile_id)));

-- Grants: readable by the viewer and by the profile's owner. Writes only through RPCs, except delete.
create policy grants_select on public.access_grants for select to authenticated
  using (viewer_id = auth.uid() or public.can_edit_profile(profile_id));
create policy grants_delete on public.access_grants for delete to authenticated
  using (viewer_id = auth.uid() or public.can_edit_profile(profile_id));

-- Invites: creator can see/delete their own. Others read via get_invite().
create policy invites_select on public.invites for select to authenticated
  using (from_user = auth.uid());
create policy invites_delete on public.invites for delete to authenticated
  using (from_user = auth.uid());

-- Keep page_count in sync.
create or replace function public.sync_page_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update documents d
     set page_count = (select count(*) from document_pages p where p.document_id = d.id)
   where d.id = coalesce(new.document_id, old.document_id);
  return null;
end $$;
create trigger document_pages_count after insert or delete on public.document_pages
  for each row execute function public.sync_page_count();

-- ---------------------------------------------------------------- signup

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, display_name)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Me'
    ), 80)
  );
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- RPCs

-- Create an invite link token. purpose 'view': "let me see your records". 'claim': hand a managed profile to its person.
create or replace function public.create_invite(p_purpose text, p_profile_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_purpose = 'claim' then
    if not exists (select 1 from profiles where id = p_profile_id and manager_id = auth.uid()) then
      raise exception 'not your managed profile';
    end if;
  elsif p_purpose = 'view' then
    p_profile_id := null;
  else
    raise exception 'bad purpose';
  end if;
  insert into invites (from_user, purpose, profile_id) values (auth.uid(), p_purpose, p_profile_id)
  returning token into v_token;
  return v_token;
end $$;

-- Preview an invite before accepting.
create or replace function public.get_invite(p_token text)
returns table (purpose text, from_name text, profile_name text, valid boolean, is_own boolean)
language sql stable security definer set search_path = public as $$
  select i.purpose,
         (select display_name from profiles where user_id = i.from_user),
         (select display_name from profiles where id = i.profile_id),
         (i.used_at is null and i.expires_at > now()),
         (i.from_user = auth.uid())
  from invites i where i.token = p_token;
$$;

-- Accept an invite.
--  view : caller approves, inviter gets read-only access to caller's own profile.
--  claim: caller takes over the managed profile; its documents move to caller's own profile,
--         the managed profile is deleted, and the former manager keeps read-only access.
create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_inv invites%rowtype;
  v_mine uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from invites where token = p_token for update;
  if not found then raise exception 'invite not found'; end if;
  if v_inv.used_at is not null or v_inv.expires_at <= now() then raise exception 'invite expired'; end if;
  if v_inv.from_user = auth.uid() then raise exception 'cannot accept your own invite'; end if;

  select id into v_mine from profiles where user_id = auth.uid();
  if v_mine is null then raise exception 'profile missing'; end if;

  if v_inv.purpose = 'claim' then
    update documents set profile_id = v_mine where profile_id = v_inv.profile_id;
    delete from profiles where id = v_inv.profile_id;
  end if;

  insert into access_grants (viewer_id, profile_id) values (v_inv.from_user, v_mine)
  on conflict (viewer_id, profile_id) do nothing;

  update invites set used_at = now(), used_by = auth.uid() where id = v_inv.id;
  return v_mine;
end $$;

create or replace function public.decline_invite(p_token text)
returns void language sql security definer set search_path = public as $$
  update invites set used_at = now(), used_by = auth.uid()
  where token = p_token and used_at is null and from_user <> auth.uid();
$$;

-- People who can see my records.
create or replace function public.list_my_viewers()
returns table (grant_id uuid, viewer_id uuid, display_name text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select g.id, g.viewer_id, vp.display_name, g.created_at
  from access_grants g
  join profiles mine on mine.id = g.profile_id and mine.user_id = auth.uid()
  left join profiles vp on vp.user_id = g.viewer_id
  order by g.created_at desc;
$$;

revoke all on function public.can_edit_profile(uuid), public.can_view_profile(uuid), public.is_my_viewer(uuid) from public, anon;
revoke all on function public.create_invite(text, uuid), public.get_invite(text), public.accept_invite(text),
  public.decline_invite(text), public.list_my_viewers() from public, anon;
grant execute on function public.can_edit_profile(uuid), public.can_view_profile(uuid), public.is_my_viewer(uuid),
  public.create_invite(text, uuid), public.get_invite(text), public.accept_invite(text),
  public.decline_invite(text), public.list_my_viewers() to authenticated;

-- ---------------------------------------------------------------- storage
-- Object path: {profile_id}/{document_id}/{page_no}.{ext}

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 20971520, array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create or replace function public.storage_profile_id(object_name text)
returns uuid language plpgsql immutable as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when others then
  return null;
end $$;

-- After a claim, documents move profiles but objects keep their original path,
-- so read/delete also resolve access through document_pages.
create or replace function public.storage_object_profile(object_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select d.profile_id from document_pages p join documents d on d.id = p.document_id
  where p.storage_path = object_name;
$$;
revoke all on function public.storage_object_profile(text) from public, anon;
grant execute on function public.storage_object_profile(text) to authenticated;

create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    public.can_view_profile(public.storage_object_profile(name))
    or public.can_view_profile(public.storage_profile_id(name))));
create policy documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.can_edit_profile(public.storage_profile_id(name)));
create policy documents_remove on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and (
    public.can_edit_profile(public.storage_object_profile(name))
    or public.can_edit_profile(public.storage_profile_id(name))));

-- ---------------------------------------------------------------- column privileges
-- Ownership columns are never client-writable.
revoke update on public.profiles, public.documents, public.document_pages, public.access_grants, public.invites from authenticated, anon;
grant update (display_name, relation) on public.profiles to authenticated;
grant update (type, doc_date, title) on public.documents to authenticated;
revoke insert on public.access_grants, public.invites from authenticated, anon;
revoke all on public.profiles, public.documents, public.document_pages, public.access_grants, public.invites from anon;
