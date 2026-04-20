// akaire viewer types — API と揃える

export type AnnotationKind = "comment" | "typo" | "suggestion" | "question" | "praise";
export type AnnotationStatus = "open" | "resolved" | "wontfix" | "duplicate";

export interface Annotation {
  id: string;
  version_id: string;
  author_email: string;
  author_github: string | null;
  page: number;
  quote: string;
  page_offset_start: number | null;
  page_offset_end: number | null;
  bbox_x1: number | null;
  bbox_y1: number | null;
  bbox_x2: number | null;
  bbox_y2: number | null;
  section_label: string | null;
  comment: string;
  kind: AnnotationKind;
  status: AnnotationStatus;
  github_issue_number: number | null;
  created_at: number;
  updated_at: number;
}

export interface Reply {
  id: string;
  annotation_id: string;
  author_email: string;
  author_github: string | null;
  body: string;
  created_at: number;
}

export interface PDFVersion {
  id: string;
  r2_key: string;
  git_commit: string | null;
  built_at: number;
  page_count: number;
  label: string | null;
  metadata_json: string | null;
}

export interface NewAnnotation {
  version_id: string;
  page: number;
  quote: string;
  page_offset_start?: number;
  page_offset_end?: number;
  bbox_x1?: number;
  bbox_y1?: number;
  bbox_x2?: number;
  bbox_y2?: number;
  section_label?: string;
  comment: string;
  kind: AnnotationKind;
}
