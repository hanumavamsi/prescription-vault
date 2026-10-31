import { Row, docTypeIcon, docTypeLabel, formatDate } from '@/components/ui';
import type { Document } from '@/lib/types';

/** One document in a grouped list. Pass personName on lists that mix profiles (Home). */
export function DocRow({
  doc,
  personName,
  onPress,
  last,
}: {
  doc: Document;
  personName?: string;
  onPress: () => void;
  last?: boolean;
}) {
  const pages = doc.page_count === 1 ? '1 page' : `${doc.page_count} pages`;
  const title = doc.title?.trim();
  const subtitle = [personName, title ? docTypeLabel[doc.type] : null, formatDate(doc.doc_date), doc.page_count > 0 ? pages : null]
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
