/**
 * Searching a person's documents on the device. Every word typed must appear somewhere in the
 * document's details (title, doctor, specialty, hospital, type, date), so "derma" finds
 * Dermatology and "rao skin" finds Dr. Rao's dermatology visits.
 */
import { docTypeLabel, formatDate } from '@/components/ui';
import type { Document } from '@/lib/types';

/** Common specialties offered as one-tap choices, with everyday words people search for them by. */
export const SPECIALTIES: { name: string; aliases: string[] }[] = [
  { name: 'General Physician', aliases: ['gp', 'family doctor', 'general medicine', 'fever', 'physician'] },
  { name: 'Dermatology', aliases: ['dermatologist', 'skin', 'hair', 'derma'] },
  { name: 'Paediatrics', aliases: ['pediatrics', 'paediatrician', 'pediatrician', 'child', 'kids', 'baby'] },
  { name: 'Gynaecology', aliases: ['gynecology', 'gynaecologist', 'gynecologist', 'obstetrics', 'obgyn', 'pregnancy'] },
  { name: 'Cardiology', aliases: ['cardiologist', 'heart', 'bp', 'blood pressure'] },
  { name: 'Orthopaedics', aliases: ['orthopedics', 'orthopaedic', 'orthopedic', 'ortho', 'bone', 'joint', 'fracture'] },
  { name: 'ENT', aliases: ['ear', 'nose', 'throat', 'otolaryngology'] },
  { name: 'Ophthalmology', aliases: ['ophthalmologist', 'eye', 'eyes', 'vision', 'optometrist', 'glasses'] },
  { name: 'Dentistry', aliases: ['dentist', 'dental', 'teeth', 'tooth'] },
  { name: 'Endocrinology', aliases: ['endocrinologist', 'diabetes', 'diabetologist', 'sugar', 'thyroid', 'hormone'] },
  { name: 'Gastroenterology', aliases: ['gastroenterologist', 'gastro', 'stomach', 'digestion', 'liver'] },
  { name: 'Neurology', aliases: ['neurologist', 'brain', 'nerve', 'headache', 'migraine'] },
  { name: 'Psychiatry', aliases: ['psychiatrist', 'mental health', 'psychology', 'anxiety', 'depression'] },
  { name: 'Pulmonology', aliases: ['pulmonologist', 'lungs', 'lung', 'chest', 'asthma', 'breathing'] },
  { name: 'Nephrology', aliases: ['nephrologist', 'kidney'] },
  { name: 'Urology', aliases: ['urologist', 'urine', 'bladder', 'prostate'] },
  { name: 'Oncology', aliases: ['oncologist', 'cancer'] },
];

const byName = new Map(SPECIALTIES.map((s) => [s.name.toLowerCase(), s]));

/** The listed specialty with this name (any case), if it is one of ours. */
export function knownSpecialty(value: string | null | undefined) {
  return value ? byName.get(value.trim().toLowerCase()) : undefined;
}

function normalize(s: string) {
  // Punctuation only, so "Dr." matches "dr" and "2026-11-04" matches "2026 11"; letters in any script stay.
  return s
    .toLowerCase()
    .replace(/[\s.,;:!?'"()[\]{}/\\|&+*_–—-]+/g, ' ')
    .trim();
}

function searchText(d: Document) {
  const spec = knownSpecialty(d.specialty);
  return normalize(
    [
      d.title,
      d.doctor,
      d.specialty,
      spec?.aliases.join(' '),
      d.hospital,
      docTypeLabel[d.type],
      formatDate(d.doc_date),
      d.doc_date,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

/** Documents whose details contain every word of the query, in their original order. */
export function searchDocs(docs: Document[], query: string): Document[] {
  const words = normalize(query).split(' ').filter(Boolean);
  if (!words.length) return docs;
  return docs.filter((d) => {
    const text = searchText(d);
    return words.every((w) => text.includes(w));
  });
}
