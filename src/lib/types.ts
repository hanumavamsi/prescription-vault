export type DocType = 'prescription' | 'report';

export type Profile = {
  id: string;
  user_id: string | null;
  manager_id: string | null;
  display_name: string;
  relation: string | null;
  created_at: string;
};

/** How the current user relates to a profile. */
export type ProfileRole = 'self' | 'managed' | 'viewer';

export type ProfileWithRole = Profile & { role: ProfileRole };

export type Document = {
  id: string;
  profile_id: string;
  type: DocType;
  doc_date: string; // YYYY-MM-DD
  title: string | null;
  doctor: string | null;
  specialty: string | null;
  /** Hospital, clinic or lab. */
  hospital: string | null;
  page_count: number;
  /** "Only me": hidden from people the owner shares records with. */
  private: boolean;
  created_by: string | null;
  created_at: string;
};

/** The editable, searchable fields of a document. */
export type DocDetails = Pick<Document, 'type' | 'doc_date' | 'title' | 'doctor' | 'specialty' | 'hospital' | 'private'>;

export type DocumentPage = {
  id: string;
  document_id: string;
  page_no: number;
  storage_path: string;
  mime: 'image/jpeg' | 'image/png' | 'application/pdf';
  size_bytes: number | null;
};

export type Viewer = {
  grant_id: string;
  viewer_id: string;
  display_name: string | null;
  since: string;
};

export type InvitePreview = {
  purpose: 'view' | 'claim';
  from_name: string | null;
  profile_name: string | null;
  valid: boolean;
  is_own: boolean;
};

/** A local file picked/scanned, ready to upload as one page. */
export type LocalPage = {
  uri: string;
  mime: DocumentPage['mime'];
  /** Optional; used for progress and size checks. */
  size?: number;
};
