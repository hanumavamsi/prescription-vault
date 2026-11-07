import { knownSpecialty, searchDocs } from '@/lib/search';

import { doc } from './fixtures';

const docs = [
  doc({ id: 'a', title: 'Skin rash', doctor: 'Dr. Rao', specialty: 'Dermatology' }),
  doc({ id: 'b', title: 'Blood test', type: 'report', hospital: 'Apollo Labs', doc_date: '2025-01-15' }),
  doc({ id: 'c', doctor: 'Dr. Mehta', specialty: 'Cardiology' }),
];
const ids = (q: string) => searchDocs(docs, q).map((d) => d.id);

describe('searchDocs', () => {
  it('returns everything for an empty or punctuation-only query', () => {
    expect(ids('')).toEqual(['a', 'b', 'c']);
    expect(ids('  .,- ')).toEqual(['a', 'b', 'c']);
  });

  it('matches every word, in any field, ignoring case and punctuation', () => {
    expect(ids('rao skin')).toEqual(['a']);
    expect(ids('DR. RAO')).toEqual(['a']);
    expect(ids('apollo report')).toEqual(['b']);
    expect(ids('rao apollo')).toEqual([]);
  });

  it('finds a specialty by its everyday aliases', () => {
    expect(ids('derma')).toEqual(['a']);
    expect(ids('heart')).toEqual(['c']);
    expect(ids('bp')).toEqual(['c']);
  });

  it('matches the raw date and the document type label', () => {
    expect(ids('2025-01')).toEqual(['b']);
    expect(ids('prescription')).toEqual(['a', 'c']);
  });

  it('keeps the original order', () => {
    expect(ids('dr')).toEqual(['a', 'c']);
  });
});

describe('knownSpecialty', () => {
  it('matches listed specialties in any case and with spaces', () => {
    expect(knownSpecialty('  cardiology ')?.name).toBe('Cardiology');
    expect(knownSpecialty('ENT')?.name).toBe('ENT');
  });

  it('returns undefined for unknown or empty values', () => {
    expect(knownSpecialty('Astrology')).toBeUndefined();
    expect(knownSpecialty(null)).toBeUndefined();
    expect(knownSpecialty('')).toBeUndefined();
  });
});
