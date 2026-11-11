-- Lower the per-page upload limit from 20 MB to 10 MB (matches MAX_PAGE_BYTES in src/lib/api.ts).
update storage.buckets set file_size_limit = 10485760 where id = 'documents';
