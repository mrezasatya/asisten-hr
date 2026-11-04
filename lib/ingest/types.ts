import type { DocType } from "./demo-source";

/** Format netral hasil ekstraksi, sama untuk .docx dan PDF. */
export type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string };

export interface ChunkDraft {
  heading_path: string; // mis. "Bab V — Cuti dan Izin > Pasal 12 — Cuti Tahunan > Ayat 1–2"
  content: string;
  chunk_order: number;
}

export interface DocumentInput {
  title: string;
  doc_type: DocType;
  doc_number: string | null;
  effective_date: string | null; // YYYY-MM-DD
  status?: "aktif" | "nonaktif";
  file_path?: string | null;
}

export type FileKind = "docx" | "pdf";

/** Error yang pesannya aman ditampilkan ke admin (Bahasa Indonesia). */
export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestError";
  }
}

export const SCANNED_PDF_MESSAGE = "Dokumen hasil scan belum didukung.";
