-- Storage quota moves into the single-row signup_limits table, so it can change without replacing a function
-- (and browser tests can force "cloud full"). Supabase dashboard -> SQL editor:
--   update public.signup_limits set storage_quota_bytes = 200 * 1024 * 1024;

alter table public.signup_limits
  add column storage_quota_bytes bigint not null default 104857600 check (storage_quota_bytes >= 0);

-- Security definer: clients can't read signup_limits. Was immutable; now stable since it reads a table.
create or replace function public.storage_quota_bytes()
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select storage_quota_bytes from signup_limits), 104857600)::bigint;
$$;
