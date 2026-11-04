import { Segmented } from '@/components/ui';
import type { DocType, Document } from '@/lib/types';

export type DocFilterValue = 'all' | DocType;

export const NO_FILTER: DocFilterValue = 'all';

const TYPES: { value: DocFilterValue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prescription', label: 'Prescriptions' },
  { value: 'report', label: 'Reports' },
];

export function applyDocFilter(docs: Document[], f: DocFilterValue): Document[] {
  return f === 'all' ? docs : docs.filter((d) => d.type === f);
}

export function isFiltered(f: DocFilterValue) {
  return f !== 'all';
}

export function DocFilters({ value, onChange }: { value: DocFilterValue; onChange: (v: DocFilterValue) => void }) {
  return <Segmented options={TYPES} value={value} onChange={onChange} />;
}
