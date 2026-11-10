// Checks that import SQL built from Supabase-shaped rows loads into local D1 and the Worker can use it.
// Usage (from cloudflare/): npm run db:migrate:local && node test/import.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toSql } from '../scripts/import-from-supabase.mjs';

const id = () => crypto.randomUUID();
const [me, mgr, viewer] = [id(), id(), id()];
const [pMe, pDad, doc] = [id(), id(), id()];
const pgTime = '2026-11-01 10:00:00.123456+00'; // how Postgres sends timestamptz
const data = {
  profiles: [
    { id: pMe, user_id: me, manager_id: null, display_name: "D'Souza", relation: null, created_at: pgTime },
    { id: pDad, user_id: null, manager_id: me, display_name: 'Dad', relation: 'Father', created_at: pgTime },
  ],
  documents: [
    { id: doc, profile_id: pMe, type: 'report', doc_date: '2026-10-30', title: "It's fine", doctor: null, specialty: null, hospital: null, page_count: 1, created_by: me, created_at: pgTime },
  ],
  document_pages: [{ id: id(), document_id: doc, page_no: 1, storage_path: `${pMe}/${doc}/1-x.jpg`, mime: 'image/jpeg', size_bytes: 14, created_at: pgTime }],
  access_grants: [{ id: id(), viewer_id: viewer, profile_id: pMe, created_at: pgTime }],
  invites: [{ id: id(), token: id(), from_user: mgr, purpose: 'view', profile_id: null, expires_at: '2099-01-01T00:00:00+00:00', used_at: null, used_by: null, created_at: pgTime }],
};

const dir = mkdtempSync(join(tmpdir(), 'rx-import-'));
const file = join(dir, 'import.sql');
const sql = toSql(data);
writeFileSync(file, sql + sql); // twice: re-running must not fail or duplicate

const run = (args) => execFileSync('npx', ['wrangler', 'd1', ...args], { encoding: 'utf8', shell: process.platform === 'win32' });
run(['execute', 'rx-vault', '--local', '--file', file]);
const query = join(dir, 'query.sql');
writeFileSync(query, `select d.title, d.page_count, d.created_at, p.display_name from documents d join profiles p on p.id = d.profile_id where d.id = '${doc}';`);
const out = JSON.parse(run(['execute', 'rx-vault', '--local', '--json', '--file', query]));
const row = out[0].results[0];
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'ok    ' : 'FAIL  '} ${msg}`);
  if (!cond) failures++;
};
check(row?.title === "It's fine" && row.display_name === "D'Souza", 'quotes survive');
check(row?.page_count === 1, 'page_count consistent after re-run (no duplicate pages)');
check(row?.created_at === '2026-11-01T10:00:00.123Z', 'timestamps converted to ISO');
process.exit(failures ? 1 : 0);
