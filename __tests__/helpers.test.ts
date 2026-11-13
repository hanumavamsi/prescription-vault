import { applyDocFilter, isFiltered } from '@/components/doc-filters';
import { formatBytes, formatDate, todayISO } from '@/components/ui';
import { entryBundle } from '@/components/update-banner';
import { pdfFileName, shareFileName } from '@/lib/share';

import { doc } from './fixtures';

describe('shareFileName / pdfFileName', () => {
  it('names single and multi-page files with the right extension', () => {
    expect(shareFileName('Blood test', { mime: 'application/pdf', page_no: 1 }, 1)).toBe('Blood test.pdf');
    expect(shareFileName('Blood test', { mime: 'image/png', page_no: 2 }, 3)).toBe('Blood test - page 2.png');
    expect(shareFileName('Blood test', { mime: 'image/jpeg', page_no: 1 }, 1)).toBe('Blood test.jpg');
  });

  it('strips characters that are unsafe in file names', () => {
    expect(pdfFileName('a/b\\c:d*e?"f<g>h|i.j')).toBe('a b c d e f g h i j.pdf');
    expect(pdfFileName('../../etc/passwd')).toBe('etc passwd.pdf');
  });

  it('falls back to "Document" and caps the length', () => {
    expect(pdfFileName('...')).toBe('Document.pdf');
    expect(pdfFileName('x'.repeat(100))).toBe(`${'x'.repeat(60)}.pdf`);
  });
});

describe('doc filters', () => {
  const docs = [doc({ id: 'rx' }), doc({ id: 'lab', type: 'report' })];
  it('filters by type, "all" keeps everything', () => {
    expect(applyDocFilter(docs, 'all')).toBe(docs);
    expect(applyDocFilter(docs, 'report').map((d) => d.id)).toEqual(['lab']);
    expect(isFiltered('all')).toBe(false);
    expect(isFiltered('prescription')).toBe(true);
  });
});

describe('dates', () => {
  it('formatDate parses YYYY-MM-DD as a local date (no timezone shift)', () => {
    const expected = '01/01/2026';
    expect(formatDate('2026-01-01')).toBe(expected);
    expect(formatDate('2026-01-01T23:59:59Z')).toBe(expected);
  });

  it('todayISO is the local date, zero-padded', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 5, 23, 30));
    expect(todayISO()).toBe('2026-03-05');
    jest.useRealTimers();
  });
});

describe('formatBytes', () => {
  it('shows KB under 1 MB, MB with one decimal above', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(820 * 1024)).toBe('820 KB');
    expect(formatBytes(12.3 * 1024 * 1024)).toBe('12.3 MB');
    expect(formatBytes(100 * 1024 * 1024)).toBe('100 MB');
  });
});

describe('entryBundle', () => {
  it('finds the hashed web entry bundle in index.html', () => {
    const html = '<script src="/_expo/static/js/web/entry-0a1b2c3d.js" defer></script>';
    expect(entryBundle(html)).toBe('/_expo/static/js/web/entry-0a1b2c3d.js');
  });

  it('returns null for the unhashed dev bundle', () => {
    expect(entryBundle('<script src="/node_modules/expo-router/entry.bundle?platform=web"></script>')).toBeNull();
  });
});
