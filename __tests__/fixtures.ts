import type { Document } from '@/lib/types';

export function doc(over: Partial<Document> = {}): Document {
  return {
    id: 'd1',
    profile_id: 'p1',
    type: 'prescription',
    doc_date: '2026-11-04',
    title: null,
    doctor: null,
    specialty: null,
    hospital: null,
    page_count: 1,
    created_by: 'u1',
    created_at: '2026-11-04T10:00:00Z',
    ...over,
  };
}
