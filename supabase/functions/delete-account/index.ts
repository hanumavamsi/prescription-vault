// Deletes the calling user's account: all stored files for their own and managed profiles,
// then the auth user (rows cascade via foreign keys).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData.user) return json({ error: 'unauthorized' }, 401);
  const uid = userData.user.id;

  const { data: profiles, error: pErr } = await admin
    .from('profiles')
    .select('id')
    .or(`user_id.eq.${uid},manager_id.eq.${uid}`);
  if (pErr) return json({ error: pErr.message }, 500);

  const profileIds = (profiles ?? []).map((p) => p.id);
  if (profileIds.length) {
    const { data: pages, error: pgErr } = await admin
      .from('document_pages')
      .select('storage_path, documents!inner(profile_id)')
      .in('documents.profile_id', profileIds);
    if (pgErr) return json({ error: pgErr.message }, 500);

    const paths = (pages ?? []).map((p) => p.storage_path);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from('documents').remove(paths.slice(i, i + 100));
      if (error) return json({ error: error.message }, 500);
    }
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(uid);
  if (delErr) return json({ error: delErr.message }, 500);
  return json({ ok: true });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
