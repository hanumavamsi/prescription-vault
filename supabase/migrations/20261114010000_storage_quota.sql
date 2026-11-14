-- Cloud storage quota: 100 MB per account, counting files in my own profile and the profiles I manage.
-- Size comes from storage.objects.metadata (set by the storage server), never from the client.
--
-- Enforced in the storage insert policy: an upload is refused once usage is already at or over the quota.
-- Trade-off: the check sees usage before this file, and concurrent uploads don't see each other, so an
-- account can overshoot by the files in flight at that moment (at most 10 MB each). Acceptable for a beta;
-- the hard limit is the 1 GB project total.
--
-- Change the quota without a deploy: create or replace public.storage_quota_bytes() in the SQL editor.

create or replace function public.storage_quota_bytes()
returns bigint language sql immutable as $$ select 104857600::bigint $$;

-- Files resolve to a profile through their page row (documents move on a claim, paths don't),
-- falling back to the {profile_id}/ path prefix for a file whose page row isn't written yet.
create or replace function public.storage_used_bytes()
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  left join document_pages pg on pg.storage_path = o.name
  left join documents d on d.id = pg.document_id
  join profiles p on p.id = coalesce(d.profile_id, public.storage_profile_id(o.name))
  where o.bucket_id = 'documents' and (p.user_id = auth.uid() or p.manager_id = auth.uid());
$$;

revoke all on function public.storage_quota_bytes(), public.storage_used_bytes() from public, anon;
grant execute on function public.storage_quota_bytes(), public.storage_used_bytes() to authenticated;

drop policy documents_write on storage.objects;
create policy documents_write on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and public.is_approved()
              and public.can_edit_profile(public.storage_profile_id(name))
              and public.storage_used_bytes() < public.storage_quota_bytes());
