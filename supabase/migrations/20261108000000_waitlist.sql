-- Beta waitlist: the first `direct_cap` accounts get in; later signups are waitlisted.
-- People who accept a family invite get in anyway, up to `total_cap` approved accounts.
-- Waitlisted users can sign in but cannot add anything (enforced by RLS below).
--
-- Change caps without a deploy (Supabase dashboard -> SQL editor):
--   update public.signup_limits set direct_cap = 60;
-- Let someone in:
--   update public.profiles set approved = true where user_id = (select id from auth.users where email = '...');

create table public.signup_limits (
  id         boolean primary key default true check (id), -- single row
  direct_cap int not null check (direct_cap >= 0),
  total_cap  int not null check (total_cap >= direct_cap)
);
insert into public.signup_limits (direct_cap, total_cap) values (50, 150);
alter table public.signup_limits enable row level security; -- no policies: not readable by clients
revoke all on public.signup_limits from anon, authenticated;

-- Not client-writable: the init migration grants update only on (display_name, relation).
alter table public.profiles add column approved boolean not null default false;
update public.profiles set approved = true where user_id is not null; -- everyone already here stays in

create or replace function public.approved_count()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from profiles where user_id is not null and approved;
$$;
revoke all on function public.approved_count() from public, anon, authenticated;

create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approved from profiles where user_id = auth.uid()), false);
$$;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

-- ---------------------------------------------------------------- signup

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Serialise signups so two at once can't both take the last seat.
  perform pg_advisory_xact_lock(hashtext('public.signup_cap'));
  insert into profiles (user_id, display_name, approved)
  values (
    new.id,
    left(coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(trim(new.raw_user_meta_data->>'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Me'
    ), 80),
    approved_count() < coalesce((select direct_cap from signup_limits), 0)
  );
  return new;
end $$;

-- ---------------------------------------------------------------- invites

create or replace function public.create_invite(p_purpose text, p_profile_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not is_approved() then raise exception 'waitlisted'; end if;
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

-- Same as init, plus: accepting an invite lets a waitlisted user in (up to total_cap).
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

  perform pg_advisory_xact_lock(hashtext('public.signup_cap'));
  update profiles set approved = true
   where id = v_mine and not approved
     and approved_count() < coalesce((select total_cap from signup_limits), 0);
  return v_mine;
end $$;

-- ---------------------------------------------------------------- RLS: waitlisted users can't add

drop policy profiles_insert_managed on public.profiles;
create policy profiles_insert_managed on public.profiles for insert to authenticated
  with check (manager_id = auth.uid() and user_id is null and public.is_approved());

drop policy documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (public.can_edit_profile(profile_id) and created_by = auth.uid() and public.is_approved());

drop policy pages_insert on public.document_pages;
create policy pages_insert on public.document_pages for insert to authenticated
  with check (public.is_approved()
              and exists (select 1 from documents d where d.id = document_id and public.can_edit_profile(d.profile_id)));

drop policy documents_write on storage.objects;
create policy documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_approved()
              and public.can_edit_profile(public.storage_profile_id(name)));
