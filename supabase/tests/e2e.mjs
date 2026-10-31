// End-to-end check of storage access rules and the delete-account function against a local stack.
// Usage: npx supabase start && npx supabase functions serve & node supabase/tests/e2e.mjs
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!ANON || !SERVICE) throw new Error('set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok    ' : 'FAIL  '} ${msg}`);
  if (!cond) failures++;
};

async function user(tag) {
  const email = `${tag}-${process.pid}@e2e.dev`;
  const { error } = await admin.auth.admin.createUser({ email, password: 'pw-123456!', email_confirm: true, user_metadata: { full_name: tag } });
  if (error) throw error;
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error: e2 } = await c.auth.signInWithPassword({ email, password: 'pw-123456!' });
  if (e2) throw e2;
  const { data: p } = await c.from('profiles').select('id').eq('user_id', data.user.id).single();
  return { c, id: data.user.id, profileId: p.id };
}

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function addDoc(u, profileId, title) {
  const { data: doc, error } = await u.c.from('documents')
    .insert({ profile_id: profileId, type: 'report', title, created_by: u.id }).select().single();
  if (error) throw error;
  const path = `${profileId}/${doc.id}/1-x.jpg`;
  const up = await u.c.storage.from('documents').upload(path, jpeg, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  const pg = await u.c.from('document_pages').insert({ document_id: doc.id, page_no: 1, storage_path: path, mime: 'image/jpeg', size_bytes: jpeg.length });
  if (pg.error) throw pg.error;
  return { doc, path };
}

const a = await user('alice');
const b = await user('bob');

const bDoc = await addDoc(b, b.profileId, 'bob report');
const { data: d1 } = await b.c.from('documents').select('page_count').eq('id', bDoc.doc.id).single();
check(d1.page_count === 1, 'page_count trigger');

let r = await a.c.storage.from('documents').download(bDoc.path);
check(!!r.error, 'stranger cannot download file');
r = await a.c.storage.from('documents').upload(`${b.profileId}/x/evil.jpg`, jpeg, { contentType: 'image/jpeg' });
check(!!r.error, 'stranger cannot upload into other profile');
r = await a.c.storage.from('documents').upload(`${a.profileId}/x/evil.exe`, jpeg, { contentType: 'application/x-msdownload' });
check(!!r.error, 'bucket rejects disallowed mime');

// share
const { data: token } = await a.c.rpc('create_invite', { p_purpose: 'view' });
r = await b.c.rpc('accept_invite', { p_token: token });
check(!r.error, 'bob approves alice');
r = await a.c.storage.from('documents').download(bDoc.path);
check(!r.error, 'viewer can download after approval');
r = await a.c.storage.from('documents').remove([bDoc.path]);
const still = await b.c.storage.from('documents').download(bDoc.path);
check(!still.error, 'viewer cannot delete file');

// revoke
const { data: viewers } = await b.c.rpc('list_my_viewers');
await b.c.from('access_grants').delete().eq('id', viewers[0].grant_id);
r = await a.c.storage.from('documents').download(bDoc.path);
check(!!r.error, 'access gone after revoke');

// claim: alice manages "Carol", hands it to carol; file keeps old path
const { data: managed } = await a.c.from('profiles').insert({ display_name: 'Carol', manager_id: a.id }).select().single();
const mDoc = await addDoc(a, managed.id, 'carol rx');
const carol = await user('carol');
const { data: claimTok } = await a.c.rpc('create_invite', { p_purpose: 'claim', p_profile_id: managed.id });
r = await carol.c.rpc('accept_invite', { p_token: claimTok });
check(!r.error, 'carol claims profile');
r = await carol.c.storage.from('documents').download(mDoc.path);
check(!r.error, 'claimer can download moved file');
r = await a.c.storage.from('documents').download(mDoc.path);
check(!r.error, 'former manager keeps view access');

// delete account
const fn = await carol.c.functions.invoke('delete-account', { method: 'POST' });
check(!fn.error, `delete-account succeeds ${fn.error?.message ?? ''}`);
const { data: gone } = await admin.auth.admin.getUserById(carol.id);
check(!gone?.user, 'carol auth user deleted');
const { data: obj } = await admin.storage.from('documents').download(mDoc.path).catch(() => ({ data: null }));
check(!obj, 'carol files deleted');
const { count } = await admin.from('documents').select('*', { count: 'exact', head: true }).eq('id', mDoc.doc.id);
check(count === 0, 'carol documents deleted');

for (const u of [a, b]) await admin.auth.admin.deleteUser(u.id);
console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
