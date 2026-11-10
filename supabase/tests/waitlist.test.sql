-- Waitlist tests. Run: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- One direct seat left and one more for invitees, whatever the local database already holds.
update signup_limits set direct_cap = approved_count() + 1, total_cap = approved_count() + 2;

create or replace function pg_temp.as_user(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

-- in (takes the last direct seat), w1 and w2 (waitlisted)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'in@test.dev');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'w1@test.dev');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f2', 'w2@test.dev');

select ok((select approved from profiles where user_id = '00000000-0000-0000-0000-0000000000e1'), 'signup within cap is approved');
select ok(not (select approved from profiles where user_id = '00000000-0000-0000-0000-0000000000f1'), 'signup over cap is waitlisted');

-- ---- waitlisted user can't add anything
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select ok(not is_approved(), 'is_approved() false for waitlisted user');
select throws_ok(
  $$ insert into documents (profile_id, type, created_by) select id, 'report', auth.uid() from profiles where user_id = auth.uid() $$,
  '42501', null, 'waitlisted user cannot add a document');
select throws_ok(
  $$ insert into profiles (display_name, manager_id) values ('Kid', auth.uid()) $$,
  '42501', null, 'waitlisted user cannot add a managed profile');
select throws_ok($$ select create_invite('view') $$, null, 'waitlisted', 'waitlisted user cannot create invites');
select throws_ok($$ update profiles set approved = true where user_id = auth.uid() $$, '42501', null, 'cannot approve yourself');
select throws_ok($$ select * from signup_limits $$, '42501', null, 'caps are not readable by clients');

-- ---- an approved user's invite lets w1 in
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
create temp table t_tok as select create_invite('view') as a, create_invite('view') as b;
reset role;
grant select on t_tok to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1');
select accept_invite((select a from t_tok));
select ok(is_approved(), 'accepting an invite approves a waitlisted user');
select lives_ok(
  $$ insert into documents (profile_id, type, created_by) select id, 'report', auth.uid() from profiles where user_id = auth.uid() $$,
  'approved invitee can add a document');

-- ---- total cap reached: w2 accepts but stays waitlisted
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select lives_ok($$ select accept_invite((select b from t_tok)) $$, 'invite still accepted at total cap');
select ok(not is_approved(), 'invitee over total cap stays waitlisted');

select * from finish();
rollback;
