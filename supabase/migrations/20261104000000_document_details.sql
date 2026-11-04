-- Optional details that make documents searchable: who wrote it, their specialty, where.
alter table public.documents
  add column doctor    text check (char_length(doctor) <= 80),
  add column specialty text check (char_length(specialty) <= 60),
  add column hospital  text check (char_length(hospital) <= 80);

-- Column privileges are explicit (see init migration); allow editors to change the new fields.
grant update (doctor, specialty, hospital) on public.documents to authenticated;
