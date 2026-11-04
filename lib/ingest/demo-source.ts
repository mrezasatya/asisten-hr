// Reads the Markdown sources in data/demo-docs (front matter + body).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type DocType = "PP" | "KEBIJAKAN" | "SOP" | "MEMO";

export interface DocMeta {
  title: string;
  doc_type: DocType;
  doc_number: string;
  effective_date: string; // YYYY-MM-DD
}

export interface DemoSource {
  slug: string; // file name without extension
  meta: DocMeta;
  body: string;
}

const DOC_TYPES: DocType[] = ["PP", "KEBIJAKAN", "SOP", "MEMO"];

export function parseFrontMatter(raw: string, file = "<input>"): { meta: DocMeta; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`${file}: front matter (---) tidak ditemukan`);
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  for (const key of ["title", "doc_type", "doc_number", "effective_date"]) {
    if (!fields[key]) throw new Error(`${file}: field "${key}" wajib diisi`);
  }
  if (!DOC_TYPES.includes(fields.doc_type as DocType)) {
    throw new Error(`${file}: doc_type harus salah satu dari ${DOC_TYPES.join(", ")}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.effective_date)) {
    throw new Error(`${file}: effective_date harus berformat YYYY-MM-DD`);
  }
  return {
    meta: {
      title: fields.title,
      doc_type: fields.doc_type as DocType,
      doc_number: fields.doc_number,
      effective_date: fields.effective_date,
    },
    body: match[2],
  };
}

export const DEMO_DOCS_DIR = path.join(process.cwd(), "data", "demo-docs");

export function loadDemoSources(dir = DEMO_DOCS_DIR): DemoSource[] {
  return readdirSync(dir)
    .filter((f) => /^\d{2}-.+\.md$/.test(f)) // hanya dokumen bernomor, bukan README
    .sort()
    .map((f) => {
      const { meta, body } = parseFrontMatter(readFileSync(path.join(dir, f), "utf8"), f);
      return { slug: f.replace(/\.md$/, ""), meta, body };
    });
}
