import { StyleSheet, View } from 'react-native';

import { Chips, Segmented } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import type { DocType, Document } from '@/lib/types';

export type TypeFilter = 'all' | DocType;
export type DateFilter = 'any' | '30d' | '6m' | '1y' | '3y';
export type DocFilterValue = { type: TypeFilter; date: DateFilter };

export const NO_FILTER: DocFilterValue = { type: 'all', date: 'any' };

const TYPES: { value: TypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'prescription', label: 'Prescriptions' },
  { value: 'report', label: 'Reports' },
];

const DATES: { value: DateFilter; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: '30d', label: 'Last 30 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last year' },
  { value: '3y', label: 'Last 3 years' },
];

/** Earliest document date (YYYY-MM-DD, local) a date filter keeps, or null for any time. */
function since(date: DateFilter): string | null {
  if (date === 'any') return null;
  const d = new Date();
  if (date === '30d') d.setDate(d.getDate() - 30);
  else d.setMonth(d.getMonth() - (date === '6m' ? 6 : date === '1y' ? 12 : 36));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Filters by type and by the document's own date (doc_date), not by when it was uploaded. */
export function applyDocFilter(docs: Document[], f: DocFilterValue): Document[] {
  const from = since(f.date);
  return docs.filter((d) => (f.type === 'all' || d.type === f.type) && (!from || d.doc_date >= from));
}

export function isFiltered(f: DocFilterValue) {
  return f.type !== 'all' || f.date !== 'any';
}

export function DocFilters({ value, onChange }: { value: DocFilterValue; onChange: (v: DocFilterValue) => void }) {
  return (
    <View style={styles.wrap}>
      <Segmented options={TYPES} value={value.type} onChange={(type) => onChange({ ...value, type })} />
      <Chips label="Document date" options={DATES} value={value.date} onChange={(date) => onChange({ ...value, date })} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
});
