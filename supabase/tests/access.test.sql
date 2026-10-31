-- Access-model tests. Run: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- users: a (requester), b (approver), c (stranger)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev', '{"full_name":"Asha"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev', '{}'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev', '{}');

select is((select count(*)::int from profiles where user_id is not null), 3, 'signup trigger creates own profiles');
select is((select display_name from profiles where user_id = '00000000-0000-0000-0000-00000000000a'), 'Asha', 'name from metadata');
select is((select display_name from profiles where user_id = '00000000-0000-0000-0000-00000000000b'), 'b', 'name from email');

create temp table t_ids as select id as b_profile from profiles where user_id = '00000000-0000-0000-0000-00000000000b';
grant select on t_ids to authenticated;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- ---- B adds a document to own profile
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into documents (profile_id, type, title, created_by)
  select id, 'report', 'B blood test', '00000000-0000-0000-0000-00000000000b' from profiles where user_id = auth.uid();
select is((select count(*)::int from documents), 1, 'B sees own document');

-- ---- A cannot see B's doc yet
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from documents), 0, 'A cannot see B docs before approval');
select is((select count(*)::int from profiles), 1, 'A sees only own profile');

-- A creates a managed profile and a doc in it
insert into profiles (display_name, manager_id) values ('Grandpa', '00000000-0000-0000-0000-00000000000a');
insert into documents (profile_id, type, title, created_by)
  select id, 'prescription', 'Grandpa BP', auth.uid() from profiles where manager_id = auth.uid();
select is((select count(*)::int from documents), 1, 'A sees managed profile doc');

-- A cannot insert a managed profile for someone else
select throws_ok(
  $$ insert into profiles (display_name, manager_id) values ('X', '00000000-0000-0000-0000-00000000000b') $$,
  '42501', null, 'cannot create profile managed by another user');

-- A cannot write documents to B's profile
select throws_ok(
  $$ insert into documents (profile_id, type, created_by)
     select b_profile, 'report', auth.uid() from t_ids $$,
  '42501', null, 'cannot insert into a profile you cannot see/edit');

-- A cannot take over ownership columns
select throws_ok(
  $$ update profiles set manager_id = '00000000-0000-0000-0000-00000000000c' where manager_id = auth.uid() $$,
  '42501', null, 'ownership columns are not updatable');

-- A cannot grant itself access directly
select throws_ok(
  $$ insert into access_grants (viewer_id, profile_id)
     select auth.uid(), id from profiles where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'grants cannot be inserted directly');

-- A creates a view invite
select ok((select create_invite('view')) is not null, 'A creates view invite');
create temp table t_tok as select token from invites where from_user = '00000000-0000-0000-0000-00000000000a' and purpose = 'view';
grant select on t_tok to authenticated;
select throws_ok($$ select accept_invite((select token from t_tok)) $$, null, 'cannot accept your own invite', 'own invite rejected');

-- ---- B previews + accepts
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select is((select from_name from get_invite((select token from t_tok))), 'Asha', 'B previews inviter name');
select lives_ok($$ select accept_invite((select token from t_tok)) $$, 'B approves');
select throws_ok($$ select accept_invite((select token from t_tok)) $$, null, 'invite expired', 'invite single use');
select is((select count(*)::int from list_my_viewers()), 1, 'B lists A as viewer');
select is((select display_name from profiles where user_id = '00000000-0000-0000-0000-00000000000a'), 'Asha', 'B can see viewer name');
select is((select count(*)::int from documents), 1, 'B still sees only own docs (not A managed)');

-- ---- A now sees B's doc but cannot modify
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from documents where title = 'B blood test'), 1, 'A sees B doc after approval');
update documents set title = 'hacked' where title = 'B blood test';
select is((select count(*)::int from documents where title = 'hacked'), 0, 'A cannot edit B doc');
delete from documents where title = 'B blood test';
select is((select count(*)::int from documents where title = 'B blood test'), 1, 'A cannot delete B doc');

-- ---- C (stranger) sees nothing
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from documents), 0, 'stranger sees no documents');

-- ---- claim: A hands Grandpa to C
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table t_claim as select create_invite('claim', (select id from profiles where manager_id = auth.uid())) as token;
reset role;
grant select on t_claim to authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select accept_invite((select token from t_claim));
select is((select count(*)::int from documents where title = 'Grandpa BP'), 1, 'claimer owns moved doc');

select * from finish();
rollback;
