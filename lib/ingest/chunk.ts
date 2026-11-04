// Chunking berbasis struktur: satu chunk per Pasal / Bagian / Langkah.
// Pasal yang terlalu panjang dipecah per ayat (heading tetap terbawa); tidak pernah memotong
// di tengah kalimat.
import type { Block, ChunkDraft } from "./types";

export interface ChunkOptions {
  /** Batas panjang konten satu chunk (karakter). ±1.200 karakter ≈ 1 pasal sedang. */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 1200;
export const PREAMBLE_HEADING = "Pembukaan";

const HEADING_PATTERNS: { re: RegExp; level: number }[] = [
  { re: /^BAB\s+[IVXLC]+\b/i, level: 1 },
  { re: /^Bagian\s+\d+\b/i, level: 1 },
  { re: /^Pasal\s+\d+[A-Z]?\b/i, level: 2 },
  { re: /^Langkah\s+\d+\b/i, level: 2 },
];

/** Level heading berdasarkan pola teks (BAB/Bagian = 1, Pasal/Langkah = 2), atau null. */
export function headingLevelFromText(text: string): number | null {
  if (text.length > 100 || /[.;,]$/.test(text)) return null;
  return HEADING_PATTERNS.find((p) => p.re.test(text))?.level ?? null;
}

const SMALL_WORDS = new Set(["dan", "di", "ke", "dari", "yang", "atau", "untuk", "serta", "pada", "dalam"]);

/** "BAB V — CUTI DAN IZIN" → "Bab V — Cuti dan Izin". Heading yang bukan huruf kapital semua dibiarkan. */
export function prettifyHeading(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t !== t.toUpperCase() || !/[A-Z]/.test(t)) return t;
  return t
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      if (/^[ivxlc]+$/.test(w) && w !== "di") return w.toUpperCase(); // angka Romawi
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/** Normalisasi: paragraf yang polanya heading (mis. dokumen tanpa style heading) dijadikan heading. */
export function normalizeBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => {
    const byText = headingLevelFromText(b.text);
    if (b.kind === "para") return byText ? { kind: "heading", level: byText, text: b.text } : b;
    return { kind: "heading", level: byText ?? b.level, text: b.text };
  });
}

interface Section {
  path: string[];
  paras: string[];
}

function toSections(blocks: Block[]): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Section = { path: [PREAMBLE_HEADING], paras: [] };
  for (const b of normalizeBlocks(blocks)) {
    if (b.kind === "heading") {
      if (current.paras.length) sections.push(current);
      while (stack.length && stack[stack.length - 1].level >= b.level) stack.pop();
      stack.push({ level: b.level, text: prettifyHeading(b.text) });
      current = { path: stack.map((s) => s.text), paras: [] };
    } else {
      current.paras.push(b.text);
    }
  }
  if (current.paras.length) sections.push(current);
  return sections;
}

const AYAT_RE = /^\((\d+)\)\s/;

interface Unit {
  label: string | null; // nomor ayat, mis. "1"
  text: string;
}

/** Kelompokkan paragraf menjadi unit ayat: "(n) ..." memulai unit baru; huruf a., b. ikut ayat sebelumnya. */
function toUnits(paras: string[]): Unit[] {
  const units: Unit[] = [];
  for (const p of paras) {
    const ayat = p.match(AYAT_RE);
    if (ayat || units.length === 0) units.push({ label: ayat?.[1] ?? null, text: p });
    else if (units[units.length - 1].label !== null || isListItem(p)) units[units.length - 1].text += `\n${p}`;
    else units.push({ label: null, text: p });
  }
  // Paragraf pengantar sebelum ayat pertama digabung ke ayat pertama.
  if (units.length > 1 && units[0].label === null && units[1].label !== null) {
    units[1].text = `${units[0].text}\n${units[1].text}`;
    units.shift();
  }
  return units;
}

const isListItem = (p: string) => /^[a-z]\.\s/.test(p);

/** Pecah teks per kalimat, lalu gabungkan sampai mendekati maxChars. Tidak memotong kalimat. */
export function splitBySentence(text: string, maxChars: number): string[] {
  // Batas kalimat: tanda baca setelah kata (min. 2 karakter), agar "a." atau "(1)" tidak terpisah.
  const sentences = text.split(/(?<=[^\s.]{2}[.;:])\s+/);
  const out: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (buf && buf.length + 1 + s.length > maxChars) {
      out.push(buf);
      buf = s;
    } else buf = buf ? `${buf} ${s}` : s;
  }
  if (buf) out.push(buf);
  return out;
}

function rangeLabel(labels: (string | null)[]): string | null {
  const nums = labels.filter((l): l is string => l !== null);
  if (nums.length === 0) return null;
  return nums.length === 1 ? `Ayat ${nums[0]}` : `Ayat ${nums[0]}–${nums[nums.length - 1]}`;
}

export function chunkBlocks(blocks: Block[], opts: ChunkOptions = {}): ChunkDraft[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const chunks: ChunkDraft[] = [];
  const push = (path: string[], content: string) =>
    chunks.push({ heading_path: path.join(" > "), content: content.trim(), chunk_order: chunks.length + 1 });

  for (const section of toSections(blocks)) {
    const whole = section.paras.join("\n");
    if (whole.length <= maxChars) {
      push(section.path, whole);
      continue;
    }
    // Terlalu panjang → kemas per ayat/paragraf.
    const units = toUnits(section.paras);
    let group: Unit[] = [];
    let part = 0;
    const flushGroup = () => {
      if (!group.length) return;
      part += 1;
      const label = rangeLabel(group.map((u) => u.label)) ?? `Potongan ${part}`;
      push([...section.path, label], group.map((u) => u.text).join("\n"));
      group = [];
    };
    for (const unit of units) {
      if (unit.text.length > maxChars) {
        flushGroup();
        const pieces = splitBySentence(unit.text, maxChars);
        pieces.forEach((piece, i) => {
          part += 1;
          const base = unit.label ? `Ayat ${unit.label}` : `Potongan ${part}`;
          push([...section.path, pieces.length > 1 ? `${base} (${i + 1}/${pieces.length})` : base], piece);
        });
        continue;
      }
      const size = group.reduce((n, u) => n + u.text.length + 1, 0);
      if (group.length && size + unit.text.length > maxChars) flushGroup();
      group.push(unit);
    }
    flushGroup();
  }
  return chunks;
}
