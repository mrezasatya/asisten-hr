import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { describe, expect, it } from "vitest";
import { chunkBlocks } from "./chunk";
import { detectFileKind, extractDocx, extractPdf, htmlToBlocks, pdfLinesToBlocks } from "./extract";
import { IngestError, SCANNED_PDF_MESSAGE } from "./types";

/** Membuat PDF minimal yang valid. `lines` kosong = halaman tanpa teks (seperti hasil scan). */
function makePdf(pages: string[][]): Buffer {
  const objs: string[] = [];
  const pageIds: number[] = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let next = 4;
  for (const lines of pages) {
    const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
    const stream = lines.length
      ? `BT /F1 11 Tf 14 TL 50 780 Td ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`
      : "";
    const contentId = next++;
    const pageId = next++;
    objs[contentId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`;
    pageIds.push(pageId);
  }
  objs[2] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = Buffer.byteLength(out, "latin1");
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

describe("htmlToBlocks", () => {
  it("membaca heading, paragraf, dan entity HTML", () => {
    const blocks = htmlToBlocks("<h1>BAB I</h1><p>Biaya &amp; uang <strong>harian</strong></p><ul><li>satu</li></ul>");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "BAB I" },
      { kind: "para", text: "Biaya & uang harian" },
      { kind: "para", text: "satu" },
    ]);
  });
});

describe("extractDocx", () => {
  it("mengekstrak .docx dengan style heading lalu bisa di-chunk per pasal", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("BAB V — CUTI DAN IZIN")] }),
            new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Pasal 12 — Cuti Tahunan")] }),
            new Paragraph({ children: [new TextRun("(1) Cuti tahunan 12 hari kerja.")] }),
          ],
        },
      ],
    });
    const blocks = await extractDocx(await Packer.toBuffer(doc));
    const chunks = chunkBlocks(blocks);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading_path).toBe("Bab V — Cuti dan Izin > Pasal 12 — Cuti Tahunan");
  });

  it("menolak file .docx rusak dengan pesan yang jelas", async () => {
    await expect(extractDocx(Buffer.from("bukan docx"))).rejects.toBeInstanceOf(IngestError);
  });
});

describe("extractPdf", () => {
  it("mengekstrak PDF berbasis teks dan mengenali heading tanpa style", async () => {
    const pdf = makePdf([
      [
        "BAB V CUTI DAN IZIN",
        "Pasal 12 Cuti Tahunan",
        "(1) Karyawan yang telah bekerja 12 bulan berhak atas cuti",
        "tahunan selama 12 hari kerja.",
        "(2) Cuti diajukan paling lambat 7 hari kerja sebelumnya.",
      ],
    ]);
    const chunks = chunkBlocks(await extractPdf(pdf));
    const pasal = chunks.find((c) => c.heading_path.includes("Pasal 12"));
    expect(pasal?.heading_path).toBe("Bab V Cuti dan Izin > Pasal 12 Cuti Tahunan");
    // Baris yang terpotong (wrap) digabung kembali menjadi satu kalimat.
    expect(pasal?.content).toContain("berhak atas cuti tahunan selama 12 hari kerja.");
  });

  it("menolak PDF tanpa teks (hasil scan)", async () => {
    await expect(extractPdf(makePdf([[], []]))).rejects.toThrow(SCANNED_PDF_MESSAGE);
  });
});

describe("pdfLinesToBlocks", () => {
  it("memulai paragraf baru pada penanda ayat dan huruf", () => {
    const blocks = pdfLinesToBlocks(["(1) Kalimat pertama yang\nberlanjut di baris dua.\na. huruf a;\nb. huruf b."]);
    expect(blocks.map((b) => b.text)).toEqual(["(1) Kalimat pertama yang berlanjut di baris dua.", "a. huruf a;", "b. huruf b."]);
  });
});

describe("detectFileKind", () => {
  it("hanya menerima .docx dan .pdf", () => {
    expect(detectFileKind("PP.DOCX")).toBe("docx");
    expect(detectFileKind("sop.pdf")).toBe("pdf");
    expect(() => detectFileKind("memo.doc")).toThrow(IngestError);
  });
});
