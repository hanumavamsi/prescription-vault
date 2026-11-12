-- "Only me" documents: hidden from people the owner shares with. Editors (owner/manager) always see them.
alter table public.documents add column private boolean not null default false;
grant update (private) on public.documents to authenticated;

create or replace function public.can_view_document(did uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from documents d
    where d.id = did and (public.can_edit_profile(d.profile_id) or (not d.private and public.can_view_profile(d.profile_id)))
  );
$$;

-- Page files: readable when their document is.
create or replace function public.can_view_object(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from document_pages p where p.storage_path = object_name and public.can_view_document(p.document_id));
$$;

revoke all on function public.can_view_document(uuid), public.can_view_object(text) from public, anon;
grant execute on function public.can_view_document(uuid), public.can_view_object(text) to authenticated;

drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  -- Inline, like profiles_select: helpers can't see a row inside its own INSERT ... RETURNING.
  using (public.can_edit_profile(profile_id) or (not private and public.can_view_profile(profile_id)));

drop policy pages_select on public.document_pages;
create policy pages_select on public.document_pages for select to authenticated
  using (public.can_view_document(document_id));

-- Viewers no longer get the folder-based fallback: only editors may read a file before its page row exists.
drop policy documents_read on storage.objects;
create policy documents_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and (
    public.can_edit_profile(public.storage_profile_id(name))
    or public.can_view_object(name)));
