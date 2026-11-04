import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoyageEmbedder, makeBatches } from "./embed";
import { ingestDocument } from "./pipeline";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

beforeEach(() => {
  vi.stubEnv("EMBEDDING_API_KEY", "test-key");
  vi.stubEnv("EMBEDDING_MODEL", "voyage-4");
  vi.stubEnv("EMBEDDING_DIMENSIONS", "4");
});
afterEach(() => vi.unstubAllEnvs());

const okResponse = (n: number, dim = 4) =>
  new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ index: i, embedding: Array(dim).fill(i) })) }));

describe("makeBatches", () => {
  it("membagi teks agar tiap request tidak melebihi batas token", () => {
    const batches = makeBatches(Array(10).fill("x".repeat(6000))); // ±2.000 token per teks
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flat()).toHaveLength(10);
  });
});

describe("createVoyageEmbedder", () => {
  it("mengirim input_type dan output_dimension yang benar", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ model: "voyage-4", input_type: "query", output_dimension: 4 });
      return okResponse(body.input.length);
    });
    const embed = createVoyageEmbedder(undefined, fetchMock as typeof fetch);
    const out = await embed(["a", "b"], "query");
    expect(out).toEqual([[0, 0, 0, 0], [1, 1, 1, 1]]);
  });

  it("mencoba ulang saat terkena rate limit (429)", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response("rate limited", { status: 429, headers: { "retry-after": "0.01" } }) : okResponse(1);
    });
    const embed = createVoyageEmbedder(undefined, fetchMock as typeof fetch);
    await expect(embed(["a"], "document")).resolves.toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("gagal jelas bila dimensi tidak cocok", async () => {
    const embed = createVoyageEmbedder(undefined, (async () => okResponse(1, 8)) as typeof fetch);
    await expect(embed(["a"], "document")).rejects.toThrow(/Dimensi embedding/);
  });
});

describe("ingestDocument", () => {
  it("menyimpan dokumen dan chunk beserta embedding", async () => {
    const inserted: Record<string, unknown[]> = { documents: [], chunks: [] };
    const fakeSupabase = {
      from: (table: string) => ({
        insert: (rows: unknown) => {
          inserted[table].push(...(Array.isArray(rows) ? rows : [rows]));
          return {
            select: () => ({ single: async () => ({ data: { id: "doc-1" }, error: null }) }),
            then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
          };
        },
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
    } as unknown as SupabaseClient;

    const docx = await Packer.toBuffer(
      new Document({
        sections: [{ children: [
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Pasal 1 — Tujuan")] }),
          new Paragraph({ children: [new TextRun("Isi pasal satu.")] }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Pasal 2 — Lingkup")] }),
          new Paragraph({ children: [new TextRun("Isi pasal dua.")] }),
        ] }],
      }),
    );
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3, 0.4]));
    const result = await ingestDocument(
      { buffer: docx, kind: "docx", meta: { title: "Kebijakan Uji", doc_type: "KEBIJAKAN", doc_number: "X/1", effective_date: "2025-01-01" } },
      { supabase: fakeSupabase, embed },
    );
    expect(result).toEqual({ documentId: "doc-1", chunkCount: 2 });
    expect(embed.mock.calls[0][0][0]).toBe("Kebijakan Uji\nPasal 1 — Tujuan\n\nIsi pasal satu.");
    expect(inserted.chunks[0]).toMatchObject({ document_id: "doc-1", heading_path: "Pasal 1 — Tujuan", embedding: "[0.1,0.2,0.3,0.4]" });
  });
});
