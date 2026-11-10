// One-time copy of all data and files from Supabase to D1 + R2. Safe to re-run (insert or ignore).
// Run from cloudflare/ after the deploy steps in README.md:
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-from-supabase.mjs [--dry-run]
// Files go up first, then rows, so no row ever points at a missing file.
// --dry-run only writes import-out/import.sql and import-out/files/ for inspection.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TABLES = {
  profiles: ['id', 'user_id', 'manager_id', 'display_name', 'relation', 'created_at'],
  documents: ['id', 'profile_id', 'type', 'doc_date', 'title', 'doctor', 'specialty', 'hospital', 'page_count', 'created_by', 'created_at'],
  document_pages: ['id', 'document_id', 'page_no', 'storage_path', 'mime', 'size_bytes', 'created_at'],
  access_grants: ['id', 'viewer_id', 'profile_id', 'created_at'],
  invites: ['id', 'token', 'from_user', 'purpose', 'profile_id', 'expires_at', 'used_at', 'used_by', 'created_at'],
};
// Postgres timestamptz -> the Worker's format (toISOString), which it compares as text.
const TIMESTAMPS = new Set(['created_at', 'expires_at', 'used_at']);

function lit(col, v) {
  if (v == null) return 'NULL';
  if (TIMESTAMPS.has(col)) v = new Date(v).toISOString();
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** SQL for D1, in foreign-key order. */
export function toSql(data) {
  const out = [];
  for (const [table, cols] of Object.entries(TABLES)) {
    for (const row of data[table] ?? []) {
      out.push(`insert or ignore into ${table} (${cols.join(', ')}) values (${cols.map((c) => lit(c, row[c])).join(', ')});`);
    }
  }
  return out.join('\n') + '\n';
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  const dry = process.argv.includes('--dry-run');
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'import-out');

  const data = {};
  for (const table of Object.keys(TABLES)) {
    data[table] = [];
    for (let from = 0; ; from += 1000) {
      const { data: rows, error } = await sb.from(table).select('*').order('id').range(from, from + 999);
      if (error) throw new Error(`${table}: ${error.message}`);
      data[table].push(...rows);
      if (rows.length < 1000) break;
    }
    console.log(`${table}: ${data[table].length} rows`);
  }

  for (const [i, p] of data.document_pages.entries()) {
    const { data: blob, error } = await sb.storage.from('documents').download(p.storage_path);
    if (error) throw new Error(`${p.storage_path}: ${error.message}`);
    const file = join(outDir, 'files', p.storage_path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
    if (!dry) {
      execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `rx-vault-files/${p.storage_path}`, '--file', file, '--content-type', p.mime, '--remote'], {
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });
    }
    console.log(`file ${i + 1}/${data.document_pages.length}`);
  }

  const sqlFile = join(outDir, 'import.sql');
  writeFileSync(sqlFile, toSql(data));
  if (!dry) {
    execFileSync('npx', ['wrangler', 'd1', 'execute', 'rx-vault', '--remote', '--file', sqlFile, '--yes'], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  console.log(dry ? `dry run: see ${outDir}` : 'import done');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
