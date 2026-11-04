// Generates data/demo-docs/docx/*.docx from the Markdown sources, so the ingest pipeline
// exercises the same .docx path (mammoth) that admin uploads will use.
// Usage: npm run docs:build
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { DEMO_DOCS_DIR, loadDemoSources, type DemoSource } from "../lib/ingest/demo-source";

const OUT_DIR = path.join(DEMO_DOCS_DIR, "docx");

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function toParagraphs(src: DemoSource): Paragraph[] {
  const out: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(src.meta.title)] }),
    new Paragraph({ children: [new TextRun(`Nomor: ${src.meta.doc_number}`)] }),
    new Paragraph({
      children: [new TextRun(`Tanggal berlaku: ${formatDate(src.meta.effective_date)}`)],
    }),
  ];
  for (const block of src.body.split(/\r?\n\s*\r?\n/)) {
    const text = block.trim();
    if (!text) continue;
    if (text.startsWith("## ")) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text.slice(3))] }));
    } else if (text.startsWith("# ")) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text.slice(2))] }));
    } else if (text.startsWith("> ")) {
      out.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: text.slice(2), italics: true, bold: true })],
        }),
      );
    } else {
      // Keep single line breaks (e.g. memo header "Kepada/Dari/Tanggal") as separate paragraphs.
      for (const line of text.split(/\r?\n/)) {
        out.push(new Paragraph({ children: [new TextRun(line.trim())] }));
      }
    }
  }
  return out;
}

/**
 * docx menyisipkan waktu "sekarang" di metadata dan di tiap entri zip, sehingga file selalu
 * dianggap berubah oleh git. Ganti dengan tanggal berlaku dokumen agar output deterministik.
 */
async function deterministic(buffer: Buffer, isoDate: string): Promise<Buffer> {
  // Waktu entri zip disimpan sebagai waktu lokal → pakai tengah malam lokal agar sama di semua zona waktu.
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const src = await JSZip.loadAsync(buffer);
  const out = new JSZip();
  for (const name of Object.keys(src.files).sort()) {
    const entry = src.files[name];
    if (entry.dir) continue;
    let content: string | Uint8Array = await entry.async("uint8array");
    if (name === "docProps/core.xml") {
      content = new TextDecoder()
        .decode(content)
        .replace(/(<dcterms:(?:created|modified)[^>]*>)[^<]*/g, `$1${isoDate}T00:00:00Z`);
    }
    out.file(name, content, { date });
  }
  return out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const sources = loadDemoSources();
  for (const src of sources) {
    const doc = new Document({
      creator: "PT Demo Rekayasa Indonesia (fiktif)",
      title: src.meta.title,
      sections: [{ children: toParagraphs(src) }],
    });
    const file = path.join(OUT_DIR, `${src.slug}.docx`);
    writeFileSync(file, await deterministic(await Packer.toBuffer(doc), src.meta.effective_date));
    console.log(`✓ ${path.relative(process.cwd(), file)}`);
  }
  console.log(`${sources.length} dokumen .docx dibuat.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
