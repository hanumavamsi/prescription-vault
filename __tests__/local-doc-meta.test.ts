import { isLocalId, mergeDocs, metaToDocument, metaToPages, type LocalDocMeta } from '@/lib/local-doc-meta';

import { doc } from './fixtures';

const meta: LocalDocMeta = {
  id: 'local-abc',
  user_id: 'u1',
  profile_id: 'p1',
  type: 'report',
  doc_date: '2026-11-05',
  title: 'Blood test',
  doctor: 'Dr. Rao',
  specialty: null,
  hospital: 'City Lab',
  pages: [
    { mime: 'image/jpeg', size: 100 },
    { mime: 'application/pdf', size: 200 },
  ],
  created_at: '2026-11-05T09:00:00Z',
};

describe('local document metadata', () => {
  it('round-trips through JSON (IndexedDB structured clone) into a Document and pages', () => {
    const back = JSON.parse(JSON.stringify(meta)) as LocalDocMeta;
    expect(metaToDocument(back)).toEqual({
      id: 'local-abc',
      profile_id: 'p1',
      type: 'report',
      doc_date: '2026-11-05',
      title: 'Blood test',
      doctor: 'Dr. Rao',
      specialty: null,
      hospital: 'City Lab',
      page_count: 2,
      size_bytes: 300,
      private: false,
      created_by: 'u1',
      created_at: '2026-11-05T09:00:00Z',
    });
    expect(metaToPages(back)).toEqual([
      { id: 'local-abc/1', document_id: 'local-abc', page_no: 1, storage_path: 'local-abc/1', mime: 'image/jpeg', size_bytes: 100 },
      { id: 'local-abc/2', document_id: 'local-abc', page_no: 2, storage_path: 'local-abc/2', mime: 'application/pdf', size_bytes: 200 },
    ]);
  });

  it('tells local ids from cloud ids', () => {
    expect(isLocalId('local-abc')).toBe(true);
    expect(isLocalId('3f2c8a1e-0000-4000-8000-000000000000')).toBe(false);
  });
});

describe('mergeDocs', () => {
  it('sorts newest doc_date first, then newest created_at', () => {
    const cloud = [
      doc({ id: 'c2', doc_date: '2026-11-04', created_at: '2026-11-04T12:00:00Z' }),
      doc({ id: 'c1', doc_date: '2026-10-01' }),
    ];
    const local = [
      doc({ id: 'local-old', doc_date: '2026-09-01' }),
      doc({ id: 'local-same', doc_date: '2026-11-04', created_at: '2026-11-04T08:00:00Z' }),
      doc({ id: 'local-new', doc_date: '2026-11-10' }),
    ];
    expect(mergeDocs(cloud, local).map((d) => d.id)).toEqual(['local-new', 'c2', 'local-same', 'c1', 'local-old']);
  });

  it('returns the cloud list untouched when there are no local docs', () => {
    const cloud = [doc()];
    expect(mergeDocs(cloud, [])).toBe(cloud);
  });
});
