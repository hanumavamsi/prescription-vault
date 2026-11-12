import { Row, docTypeIcon, docTypeLabel, formatDate } from '@/components/ui';
import type { Document } from '@/lib/types';

/** One document in a grouped list. */
export function DocRow({ doc, onPress, last }: { doc: Document; onPress: () => void; last?: boolean }) {
  const pages = doc.page_count === 1 ? '1 page' : `${doc.page_count} pages`;
  const title = doc.title?.trim();
  const subtitle = [
    doc.private ? 'Only me' : null,
    title ? docTypeLabel[doc.type] : null,
    doc.specialty?.trim(),
    doc.doctor?.trim(),
    formatDate(doc.doc_date),
    doc.page_count > 0 ? pages : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Row
      icon={docTypeIcon[doc.type]}
      title={title || docTypeLabel[doc.type]}
      subtitle={subtitle}
      onPress={onPress}
      last={last}
    />
  );
}
