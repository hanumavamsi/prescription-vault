-- A page row may only point at a file inside its own document's folder ({profile_id}/{document_id}/...).
-- Without this, an editor of any document could attach someone else's not-yet-linked file to it and then
-- read or delete it (file access resolves through document_pages). The profile segment isn't checked:
-- after a claim, documents move profiles but their files keep the original path.
drop policy pages_insert on public.document_pages;
create policy pages_insert on public.document_pages for insert to authenticated
  with check (public.is_approved()
              and split_part(storage_path, '/', 2) = document_id::text
              and exists (select 1 from documents d where d.id = document_id and public.can_edit_profile(d.profile_id)));
