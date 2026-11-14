-- Storage quota tests. Run: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

update signup_limits set direct_cap = 1000000, total_cap = 1000000;

-- users: a (owner, manages Grandpa), b (other)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'qa@test.dev'),
  ('00000000-0000-0000-0000-0000000000b1', 'qb@test.dev');
insert into profiles (display_name, manager_id) values ('Grandpa', '00000000-0000-0000-0000-0000000000a1');

create temp table t_p as select
  (select id from profiles where user_id = '00000000-0000-0000-0000-0000000000a1') as a_own,
  (select id from profiles where manager_id = '00000000-0000-0000-0000-0000000000a1') as a_managed,
  (select id from profiles where user_id = '00000000-0000-0000-0000-0000000000b1') as b_own;
grant select on t_p to authenticated;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- 30 MB own + 40 MB managed for A; 50 MB for B.
insert into storage.objects (bucket_id, name, metadata) select 'documents', a_own || '/d/1.jpg', '{"size": 31457280}' from t_p;
insert into storage.objects (bucket_id, name, metadata) select 'documents', a_managed || '/d/1.jpg', '{"size": 41943040}' from t_p;
insert into storage.objects (bucket_id, name, metadata) select 'documents', b_own || '/d/1.jpg', '{"size": 52428800}' from t_p;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is(storage_quota_bytes(), 104857600::bigint, 'quota is 100 MB');
select is(storage_used_bytes(), 73400320::bigint, 'usage counts own and managed profiles, not others');

select lives_ok(
  $$ insert into storage.objects (bucket_id, name, metadata) select 'documents', a_own || '/d/2.jpg', '{"size": 31457280}' from t_p $$,
  'upload allowed under quota (overshoot by the in-flight file)');
select is(storage_used_bytes(), 104857600::bigint, 'usage is now exactly the quota');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, metadata) select 'documents', a_own || '/d/3.jpg', '{"size": 1}' from t_p $$,
  '42501', null, 'upload into own profile rejected at quota');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, metadata) select 'documents', a_managed || '/d/3.jpg', '{"size": 1}' from t_p $$,
  '42501', null, 'upload into managed profile rejected at quota');

reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(storage_used_bytes(), 52428800::bigint, 'B sees only own usage');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, metadata) select 'documents', b_own || '/d/2.jpg', '{"size": 1}' from t_p $$,
  'other account unaffected');

select * from finish();
rollback;
