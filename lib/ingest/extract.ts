// Ekstraksi teks dari .docx (mammoth) dan PDF berbasis teks (unpdf) menjadi Block[].
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { IngestError, SCANNED_PDF_MESSAGE, type Block, type FileKind } from "./types";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/[^\S\n]+/g, " ")
    .trim();
}

/** Mengubah HTML hasil mammoth menjadi Block[]. Diekspor untuk pengujian. */
export function htmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  const re = /<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[1].toLowerCase();
    const text = cleanText(m[2]);
    if (!text) continue;
    if (tag.startsWith("h")) blocks.push({ kind: "heading", level: Number(tag[1]), text });
    else for (const line of text.split("\n")) if (line.trim()) blocks.push({ kind: "para", text: line.trim() });
  }
  return blocks;
}

export async function extractDocx(buffer: Buffer): Promise<Block[]> {
  let html: string;
  try {
    ({ value: html } = await mammoth.convertToHtml({ buffer }));
  } catch {
    throw new IngestError("File .docx tidak dapat dibaca. Pastikan file tidak rusak atau terkunci kata sandi.");
  }
  const blocks = htmlToBlocks(html);
  if (blocks.length === 0) throw new IngestError("Dokumen .docx tidak berisi teks.");
  return blocks;
}

// Baris baru dimulai sebagai paragraf baru bila diawali penanda ayat/huruf/angka.
const NEW_PARA_START = /^(\(\d+\)|[a-z]\.\s|\d+\.\s|>|Kepada:|Dari:|Tanggal:|Perihal:|Nomor:)/;

/** Menggabungkan baris PDF yang terpotong (wrap) menjadi paragraf utuh. Diekspor untuk pengujian. */
export function pdfLinesToBlocks(pages: string[]): Block[] {
  const paras: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) paras.push(current.trim());
    current = "";
  };
  for (const page of pages) {
    for (const raw of page.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim();
      if (!line) {
        flush();
        continue;
      }
      if (/^\d+$/.test(line)) continue; // nomor halaman
      if (looksLikeHeadingLine(line) || NEW_PARA_START.test(line)) {
        flush();
        current = line;
        if (looksLikeHeadingLine(line)) flush();
        continue;
      }
      current = current ? `${current} ${line}` : line;
      if (/[.;:]$/.test(line) && !/\b(No|dst|dsb|Rp)\.$/i.test(line)) flush();
    }
    // Jangan flush di batas halaman: kalimat bisa berlanjut ke halaman berikutnya.
  }
  flush();
  return paras.map((text) => ({ kind: "para", text }));
}

function looksLikeHeadingLine(line: string): boolean {
  return /^(BAB\s+[IVXLC]+|Pasal\s+\d+[A-Z]?|Bagian\s+\d+|Langkah\s+\d+)\b/i.test(line) && line.length <= 100 && !/[.;,]$/.test(line);
}

export async function extractPdf(buffer: Buffer): Promise<Block[]> {
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    ({ text: pages } = await extractText(pdf, { mergePages: false }));
  } catch {
    throw new IngestError("File PDF tidak dapat dibaca. Pastikan file tidak rusak atau terkunci kata sandi.");
  }
  // PDF hasil scan hanya berisi gambar: (hampir) tidak ada teks yang bisa diekstrak.
  const textPages = pages.filter((p) => p.replace(/\s/g, "").length >= 30).length;
  if (pages.length === 0 || textPages / pages.length < 0.5) {
    throw new IngestError(SCANNED_PDF_MESSAGE);
  }
  return pdfLinesToBlocks(pages);
}

export function detectFileKind(fileName: string): FileKind {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "docx") return "docx";
  if (ext === "pdf") return "pdf";
  throw new IngestError("Format file tidak didukung. Gunakan .docx atau PDF berbasis teks.");
}

export async function extractBlocks(buffer: Buffer, kind: FileKind): Promise<Block[]> {
  return kind === "docx" ? extractDocx(buffer) : extractPdf(buffer);
}
