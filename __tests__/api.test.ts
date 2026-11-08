/**
 * Data layer against a fake Worker. `mockApi` decides each response from method + path, so tests
 * can fail any step (e.g. the second page upload). Access rules are tested in cloudflare/test/smoke.mjs.
 */
process.env.EXPO_PUBLIC_API_URL = 'https://api.test/';

import * as api from '@/lib/api';
import { supabase } from '@/lib/supabase';

type Req = { method: string; path: string; body?: unknown; headers: Record<string, string> };

const mockApi = jest.fn((_r: Req): { status?: number; body?: unknown } => ({ body: { ok: true } }));
const requests = () => mockApi.mock.calls.map(([r]) => r);
const mockSession = { current: { access_token: 'tok-123' } as { access_token: string } | null };
const mockReadBytes = jest.fn(async (_uri: string) => new ArrayBuffer(10));

jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: mockSession.current } }), signOut: jest.fn() } },
}));
jest.mock('@/lib/bytes', () => ({ readBytes: (uri: string) => mockReadBytes(uri) }));
jest.mock('@/lib/runtime', () => ({ inviteBaseUrl: () => 'https://rx.test/invite' }));

beforeEach(() => {
  jest.clearAllMocks();
  mockSession.current = { access_token: 'tok-123' };
  mockApi.mockImplementation(() => ({ body: { ok: true } }));
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const raw = init.body;
    const r = mockApi({
      method: init.method!,
      path: url.replace('https://api.test', ''),
      body: typeof raw === 'string' ? JSON.parse(raw) : raw,
      headers: init.headers as Record<string, string>,
    });
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.body } as Response;
  }) as unknown as typeof fetch;
});

describe('requests', () => {
  it('sends the Supabase access token to the API', async () => {
    mockApi.mockReturnValue({ body: [] });
    await api.listProfiles();
    expect(requests()[0]).toMatchObject({ method: 'GET', path: '/profiles', headers: { Authorization: 'Bearer tok-123' } });
  });

  it('throws when signed out, without calling the API', async () => {
    mockSession.current = null;
    await expect(api.listProfiles()).rejects.toThrow('Not signed in');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('surfaces API errors', async () => {
    mockApi.mockReturnValue({ status: 404, body: { error: 'Profile not found' } });
    await expect(api.listDocuments('p1', 'report')).rejects.toThrow('Profile not found');
    expect(requests()[0].path).toBe('/profiles/p1/documents?type=report');
  });

  it('getProfile finds the profile in the list', async () => {
    mockApi.mockReturnValue({ body: [{ id: 'a', role: 'self' }] });
    await expect(api.getProfile('a')).resolves.toMatchObject({ role: 'self' });
    await expect(api.getProfile('zzz')).rejects.toThrow('Profile not found');
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

  function apiWithDoc(failPage?: number) {
    mockApi.mockImplementation((r) => {
      if (r.method === 'POST' && r.path === '/documents') return { status: 201, body: { id: 'doc1', page_count: 0 } };
      if (failPage && r.path === `/documents/doc1/pages/${failPage}`) return { status: 500, body: { error: 'network down' } };
      return { body: { ok: true } };
    });
  }

  it('rejects an empty document before calling the API', async () => {
    await expect(api.createDocument({ ...input, pages: [] })).rejects.toThrow('Add at least one page');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('trims fields, uploads pages in order with their type and reports progress', async () => {
    apiWithDoc();
    const progress = jest.fn();
    const doc = await api.createDocument(input, progress);

    expect(requests()[0].body).toMatchObject({ profile_id: 'p1', title: 'Blood test', doctor: null });
    const puts = requests().filter((r) => r.method === 'PUT');
    expect(puts.map((r) => [r.path, r.headers['Content-Type']])).toEqual([
      ['/documents/doc1/pages/1', 'image/jpeg'],
      ['/documents/doc1/pages/2', 'application/pdf'],
    ]);
    expect(puts[0].body).toBeInstanceOf(ArrayBuffer);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(doc.page_count).toBe(2);
  });

  it('deletes the document when a later page fails', async () => {
    apiWithDoc(2);
    await expect(api.createDocument(input)).rejects.toThrow('network down');
    expect(requests().at(-1)).toMatchObject({ method: 'DELETE', path: '/documents/doc1' });
  });

  it('refuses pages over 20 MB and cleans up', async () => {
    apiWithDoc();
    mockReadBytes.mockResolvedValueOnce(new ArrayBuffer(api.MAX_PAGE_BYTES + 1));
    await expect(api.createDocument(input)).rejects.toThrow('Page 1 is larger than 20 MB');
    expect(requests().some((r) => r.method === 'PUT')).toBe(false);
    expect(requests().at(-1)).toMatchObject({ method: 'DELETE', path: '/documents/doc1' });
  });
});

describe('files', () => {
  it('asks the API to sign the storage path', async () => {
    mockApi.mockReturnValue({ body: { url: 'https://api.test/files/x?sig=1' } });
    await expect(api.signedPageUrl('p1/d1/1-a.jpg', 60)).resolves.toBe('https://api.test/files/x?sig=1');
    expect(requests()[0].path).toBe('/sign?path=p1%2Fd1%2F1-a.jpg&ttl=60');
  });
});

describe('invites', () => {
  it('creates view and claim links from the token', async () => {
    mockApi.mockReturnValue({ status: 201, body: { token: 'tok' } });
    await expect(api.createViewInvite()).resolves.toBe('https://rx.test/invite/tok');
    expect(requests()[0].body).toEqual({ purpose: 'view' });
    await expect(api.createClaimInvite('p1')).resolves.toBe('https://rx.test/invite/tok');
    expect(requests()[1].body).toEqual({ purpose: 'claim', profile_id: 'p1' });
  });

  it('previews an invite, or null when the token is unknown', async () => {
    const preview = { purpose: 'view', from_name: 'Asha', profile_name: null, valid: true, is_own: false };
    mockApi.mockReturnValueOnce({ body: preview }).mockReturnValueOnce({ body: null });
    await expect(api.getInvite('tok')).resolves.toEqual(preview);
    await expect(api.getInvite('nope')).resolves.toBeNull();
  });

  it('accepts and declines by token, surfacing server errors', async () => {
    await api.acceptInvite('tok');
    expect(requests()[0]).toMatchObject({ method: 'POST', path: '/invites/tok/accept' });
    mockApi.mockReturnValueOnce({ status: 400, body: { error: 'invite expired' } });
    await expect(api.declineInvite('tok')).rejects.toThrow('invite expired');
    expect(requests()[1].path).toBe('/invites/tok/decline');
  });
});

describe('account', () => {
  it('deletes the account, then signs out', async () => {
    await api.deleteAccount();
    expect(requests()[0]).toMatchObject({ method: 'DELETE', path: '/account' });
    expect(supabase.auth.signOut).toHaveBeenCalled();
  });

  it('stays signed in when deletion fails', async () => {
    mockApi.mockReturnValue({ status: 502, body: { error: 'Could not delete login' } });
    await expect(api.deleteAccount()).rejects.toThrow('Could not delete login');
    expect(supabase.auth.signOut).not.toHaveBeenCalled();
  });
});
