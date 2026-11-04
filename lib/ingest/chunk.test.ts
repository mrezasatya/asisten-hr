import { describe, expect, it } from "vitest";
import { chunkBlocks, headingLevelFromText, normalizeBlocks, prettifyHeading, splitBySentence } from "./chunk";
import type { Block } from "./types";

const h = (level: number, text: string): Block => ({ kind: "heading", level, text });
const p = (text: string): Block => ({ kind: "para", text });

describe("prettifyHeading", () => {
  it("merapikan heading huruf kapital dan mempertahankan angka Romawi", () => {
    expect(prettifyHeading("BAB V — CUTI DAN IZIN")).toBe("Bab V — Cuti dan Izin");
    expect(prettifyHeading("BAB IX — TATA TERTIB, DISIPLIN, DAN SANKSI")).toBe("Bab IX — Tata Tertib, Disiplin, dan Sanksi");
  });
  it("tidak mengubah heading yang sudah bercampur huruf", () => {
    expect(prettifyHeading("Pasal 12 — Cuti Tahunan")).toBe("Pasal 12 — Cuti Tahunan");
  });
});

describe("headingLevelFromText", () => {
  it("mengenali pola heading", () => {
    expect(headingLevelFromText("BAB III WAKTU KERJA")).toBe(1);
    expect(headingLevelFromText("Bagian 4 — Prosedur")).toBe(1);
    expect(headingLevelFromText("Pasal 12 Cuti Tahunan")).toBe(2);
    expect(headingLevelFromText("Langkah 3 — Persetujuan")).toBe(2);
  });
  it("tidak menganggap kalimat isi sebagai heading", () => {
    expect(headingLevelFromText("Pasal 12 ayat (4) Peraturan Perusahaan berlaku untuk semua.")).toBeNull();
    expect(headingLevelFromText("Karyawan wajib hadir.")).toBeNull();
  });
});

describe("normalizeBlocks", () => {
  it("mengubah paragraf berpola heading (dokumen tanpa style heading) menjadi heading", () => {
    const out = normalizeBlocks([p("BAB I KETENTUAN UMUM"), p("Pasal 1 Pengertian"), p("(1) Isi.")]);
    expect(out.map((b) => b.kind)).toEqual(["heading", "heading", "para"]);
  });
});

describe("chunkBlocks", () => {
  it("satu chunk per pasal dengan heading_path lengkap", () => {
    const chunks = chunkBlocks([
      p("Peraturan Perusahaan"),
      h(1, "BAB V — CUTI DAN IZIN"),
      h(2, "Pasal 12 — Cuti Tahunan"),
      p("(1) Karyawan berhak atas cuti tahunan 12 hari kerja."),
      p("(2) Cuti diajukan 7 hari sebelumnya."),
      h(2, "Pasal 13 — Izin Sakit"),
      p("(1) Karyawan wajib memberi tahu atasan."),
    ]);
    expect(chunks.map((c) => c.heading_path)).toEqual([
      "Pembukaan",
      "Bab V — Cuti dan Izin > Pasal 12 — Cuti Tahunan",
      "Bab V — Cuti dan Izin > Pasal 13 — Izin Sakit",
    ]);
    expect(chunks[1].content).toContain("12 hari kerja");
    expect(chunks[1].content).toContain("(2) Cuti");
    expect(chunks.map((c) => c.chunk_order)).toEqual([1, 2, 3]);
  });

  it("heading tanpa isi (BAB) tidak menjadi chunk sendiri", () => {
    const chunks = chunkBlocks([h(1, "BAB I"), h(2, "Pasal 1"), p("Isi pasal.")]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].heading_path).toBe("Bab I > Pasal 1");
  });

  it("pasal panjang dipecah per ayat dan heading tetap terbawa", () => {
    const ayat = (n: number) => p(`(${n}) ${"Ketentuan ayat ini berlaku untuk seluruh karyawan. ".repeat(6).trim()}`);
    const chunks = chunkBlocks(
      [h(2, "Pasal 16 — Izin Khusus"), p("Pengantar pasal:"), ayat(1), p("a. huruf a;"), p("b. huruf b."), ayat(2), ayat(3)],
      { maxChars: 700 },
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.heading_path.startsWith("Pasal 16 — Izin Khusus > Ayat ")).toBe(true);
      expect(c.content.length).toBeLessThanOrEqual(700);
    }
    // Pengantar ikut ayat pertama, huruf a/b tetap bersama ayat (1).
    expect(chunks[0].content.startsWith("Pengantar pasal:\n(1)")).toBe(true);
    expect(chunks[0].content).toContain("b. huruf b.");
    // Semua ayat tercakup, tidak ada yang hilang.
    const all = chunks.map((c) => c.content).join("\n");
    for (const n of [1, 2, 3]) expect(all).toContain(`(${n}) `);
  });

  it("ayat yang sangat panjang dipecah per kalimat, tidak di tengah kalimat", () => {
    const sentence = "Karyawan wajib menyerahkan dokumen pendukung yang sah kepada HR.";
    const chunks = chunkBlocks([h(2, "Pasal 9"), p(`(1) ${Array(30).fill(sentence).join(" ")}`)], { maxChars: 300 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.content.length).toBeLessThanOrEqual(300);
      expect(c.content.trim().endsWith(".")).toBe(true);
      expect(c.heading_path).toMatch(/^Pasal 9 > Ayat 1 \(\d+\/\d+\)$/);
    }
  });
});

describe("splitBySentence", () => {
  it("tidak memisahkan penanda huruf 'a.' dari isinya", () => {
    const parts = splitBySentence("Daftar berikut: a. satu dua tiga; b. empat lima enam.", 25);
    expect(parts.some((s) => s === "a." || s === "b.")).toBe(false);
  });
});
