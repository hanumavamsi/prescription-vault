/**
 * Data layer against a fake Supabase client. Each query records its table and calls; `mockDb`
 * decides the result, so tests can fail any step (e.g. the second page upload).
 */
import * as api from '@/lib/api';
import { supabase } from '@/lib/supabase';

type Call = [string, ...unknown[]];
type Query = { table: string; calls: Call[] };

const mockDb = jest.fn((_q: Query): { data: unknown; error: { message: string } | null } => ({ data: null, error: null }));
const mockStorage = {
  upload: jest.fn(async (_path: string, _bytes: unknown, _opts: unknown) => ({ error: null as { message: string } | null })),
  remove: jest.fn(async (_paths: string[]) => ({ error: null as { message: string } | null })),
  createSignedUrl: jest.fn(),
};
const mockSession = { current: { user: { id: 'me' } } as { user: { id: string } } | null };
const mockReadBytes = jest.fn(async (_uri: string) => new ArrayBuffer(10));

jest.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const q = { table, calls: [] as Call[] };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'update', 'delete', 'eq', 'order', 'single']) {
      b[m] = (...args: unknown[]) => {
        q.calls.push([m, ...args]);
        return b;
      };
    }
    b.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve().then(() => mockDb(q)).then(ok, fail);
    return b;
  };
  return {
    supabase: {
      from: builder,
      storage: { from: () => mockStorage },
      auth: { getSession: async () => ({ data: { session: mockSession.current } }), signOut: jest.fn() },
      rpc: jest.fn(),
      functions: { invoke: jest.fn() },
    },
  };
});
jest.mock('@/lib/bytes', () => ({ readBytes: (uri: string) => mockReadBytes(uri) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'uuid' }));
jest.mock('@/lib/runtime', () => ({ inviteBaseUrl: () => 'https://rx.test/invite' }));

const has = (q: Query, method: string) => q.calls.some(([m]) => m === method);

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.current = { user: { id: 'me' } };
  mockDb.mockImplementation(() => ({ data: null, error: null }));
});

describe('listProfiles', () => {
  it('keeps only my, managed and shared profiles, in that order, with roles', async () => {
    mockDb.mockImplementation((q) => {
      if (q.table === 'profiles') {
        return {
          data: [
            { id: 'shared', user_id: 'other', manager_id: null },
            { id: 'stranger', user_id: 'x', manager_id: null },
            { id: 'managed', user_id: null, manager_id: 'me' },
            { id: 'self', user_id: 'me', manager_id: null },
          ],
          error: null,
        };
      }
      return { data: [{ profile_id: 'shared' }], error: null }; // access_grants
    });
    const list = await api.listProfiles();
    expect(list.map((p) => [p.id, p.role])).toEqual([
      ['self', 'self'],
      ['managed', 'managed'],
      ['shared', 'viewer'],
    ]);
  });

  it('throws when signed out', async () => {
    mockSession.current = null;
    await expect(api.listProfiles()).rejects.toThrow('Not signed in');
  });

  it('surfaces database errors', async () => {
    mockDb.mockImplementation(() => ({ data: null, error: { message: 'permission denied' } }));
    await expect(api.listProfiles()).rejects.toThrow('permission denied');
  });
});

describe('createDocument', () => {
  const input = {
    profileId: 'p1',
    type: 'report' as const,
    docDate: '2026-11-04',
    title: '  Blood test  ',
    doctor: '   ',
    pages: [
      { uri: 'file://1.jpg', mime: 'image/jpeg' as const },
      { uri: 'file://2.pdf', mime: 'application/pdf' as const },
    ],
  };

  function dbWithDoc() {
    mockDb.mockImplementation((q) =>
      q.table === 'documents' && has(q, 'insert') ? { data: { id: 'doc1', page_count: 0 }, error: null } : { data: null, error: null },
    );
  }

  it('rejects an empty document before touching the database', async () => {
    await expect(api.createDocument({ ...input, pages: [] })).rejects.toThrow('Add at least one page');
    expect(mockDb).not.toHaveBeenCalled();
  });

  it('trims fields, uploads pages in order and reports progress', async () => {
    dbWithDoc();
    const progress = jest.fn();
    const doc = await api.createDocument(input, progress);

    const insert = mockDb.mock.calls.map(([q]) => q).find((q) => q.table === 'documents' && has(q, 'insert'))!;
    expect(insert.calls.find(([m]) => m === 'insert')![1]).toMatchObject({
      profile_id: 'p1',
      title: 'Blood test',
      doctor: null,
      created_by: 'me',
    });
    expect(mockStorage.upload.mock.calls.map(([path]) => path)).toEqual(['p1/doc1/1-uuid.jpg', 'p1/doc1/2-uuid.pdf']);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(doc.page_count).toBe(2);
  });

  it('removes uploaded files and the document when a later page fails', async () => {
    dbWithDoc();
    mockStorage.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: 'network down' } });

    await expect(api.createDocument(input)).rejects.toThrow('network down');
    expect(mockStorage.remove).toHaveBeenCalledWith(['p1/doc1/1-uuid.jpg']);
    const deleted = mockDb.mock.calls.map(([q]) => q).find((q) => q.table === 'documents' && has(q, 'delete'));
    expect(deleted?.calls).toContainEqual(['eq', 'id', 'doc1']);
  });

  it('refuses pages over 10 MB and cleans up', async () => {
    dbWithDoc();
    mockReadBytes.mockResolvedValueOnce(new ArrayBuffer(api.MAX_PAGE_BYTES + 1));

    await expect(api.createDocument(input)).rejects.toThrow('Page 1 is larger than 10 MB');
    expect(mockStorage.upload).not.toHaveBeenCalled();
    expect(mockDb.mock.calls.some(([q]) => q.table === 'documents' && has(q, 'delete'))).toBe(true);
  });
});

describe('deleteDocument', () => {
  it('removes the files before the row', async () => {
    mockDb.mockImplementation((q) =>
      q.table === 'document_pages' ? { data: [{ storage_path: 'a' }, { storage_path: 'b' }], error: null } : { data: null, error: null },
    );
    await api.deleteDocument('doc1');
    expect(mockStorage.remove).toHaveBeenCalledWith(['a', 'b']);
    expect(mockDb.mock.calls.some(([q]) => q.table === 'documents' && has(q, 'delete'))).toBe(true);
  });

  it('keeps the row when the files cannot be removed', async () => {
    mockDb.mockImplementation((q) =>
      q.table === 'document_pages' ? { data: [{ storage_path: 'a' }], error: null } : { data: null, error: null },
    );
    mockStorage.remove.mockResolvedValueOnce({ error: { message: 'storage down' } });
    await expect(api.deleteDocument('doc1')).rejects.toThrow('storage down');
    expect(mockDb.mock.calls.some(([q]) => q.table === 'documents' && has(q, 'delete'))).toBe(false);
  });
});

describe('invites', () => {
  const rpc = supabase.rpc as jest.Mock;

  it('creates view and claim links from the token', async () => {
    rpc.mockResolvedValue({ data: 'tok', error: null });
    await expect(api.createViewInvite()).resolves.toBe('https://rx.test/invite/tok');
    expect(rpc).toHaveBeenLastCalledWith('create_invite', { p_purpose: 'view' });
    await expect(api.createClaimInvite('p1')).resolves.toBe('https://rx.test/invite/tok');
    expect(rpc).toHaveBeenLastCalledWith('create_invite', { p_purpose: 'claim', p_profile_id: 'p1' });
  });

  it('previews an invite, or null when the token is unknown', async () => {
    const preview = { purpose: 'view', from_name: 'Asha', profile_name: null, valid: true, is_own: false };
    rpc.mockResolvedValueOnce({ data: [preview], error: null });
    await expect(api.getInvite('tok')).resolves.toEqual(preview);
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(api.getInvite('nope')).resolves.toBeNull();
  });

  it('accepts and declines by token, surfacing server errors', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await api.acceptInvite('tok');
    expect(rpc).toHaveBeenLastCalledWith('accept_invite', { p_token: 'tok' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'invite expired' } });
    await expect(api.declineInvite('tok')).rejects.toThrow('invite expired');
    expect(rpc).toHaveBeenLastCalledWith('decline_invite', { p_token: 'tok' });
  });
});
