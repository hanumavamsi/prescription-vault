-- Total upload size per document, so lists can show it without fetching pages.
-- Not granted for client update (column privileges are explicit, see init migration); the trigger maintains it.
alter table public.documents add column size_bytes bigint not null default 0;

-- Sums the client-reported page sizes: pages may be inserted before their storage object exists, and the
-- client sets size_bytes from the exact bytes it uploads.
create or replace function public.sync_page_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update documents d
     set page_count = (select count(*) from document_pages p where p.document_id = d.id),
         size_bytes = (select coalesce(sum(p.size_bytes), 0) from document_pages p where p.document_id = d.id)
   where d.id = coalesce(new.document_id, old.document_id);
  return null;
end $$;

update public.documents d
   set size_bytes = s.total
  from (select document_id, sum(size_bytes) as total from public.document_pages group by document_id) s
 where s.document_id = d.id and s.total is not null;
