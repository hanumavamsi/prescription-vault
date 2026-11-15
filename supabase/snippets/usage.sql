-- Who is using Rx Vault. Run in Supabase dashboard -> SQL editor (needs the service role; these
-- read auth.users, so never expose them as views in the public schema).

-- 1. Every account: who, when, last seen, approved, how much they use it.
select u.email,
       u.created_at::date                        as signed_up,
       u.last_sign_in_at::date                   as last_sign_in,
       p.approved,
       u.raw_app_meta_data->>'provider'          as sign_in_with,
       (select count(*) from profiles m where m.manager_id = u.id)               as family_profiles,
       (select count(*) from documents d where d.created_by = u.id)              as documents,
       pg_size_pretty(coalesce((select sum(dp.size_bytes) from document_pages dp
         join documents d on d.id = dp.document_id where d.created_by = u.id), 0)) as storage
from auth.users u
left join profiles p on p.user_id = u.id
order by u.created_at desc;

-- 2. Signups per day (last 30 days).
select created_at::date as day, count(*) as signups
from auth.users
where created_at > now() - interval '30 days'
group by 1 order by 1 desc;

-- 3. Activation funnel: signed up -> added a document -> shared with family.
select count(*)                                                                   as accounts,
       count(*) filter (where exists (select 1 from documents d where d.created_by = u.id)) as added_document,
       count(*) filter (where exists (select 1 from invites i where i.from_user = u.id))    as created_invite,
       count(*) filter (where u.last_sign_in_at > now() - interval '7 days')               as active_last_7_days
from auth.users u;
