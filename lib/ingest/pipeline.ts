// Ekstrak → chunk → embed → simpan ke Supabase.
import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkBlocks, type ChunkOptions } from "./chunk";
import { embeddingText, type EmbedFn } from "./embed";
import { extractBlocks } from "./extract";
import { IngestError, type ChunkDraft, type DocumentInput, type FileKind } from "./types";

const INSERT_BATCH = 50;

export interface IngestParams {
  buffer: Buffer;
  kind: FileKind;
  meta: DocumentInput;
  chunkOptions?: ChunkOptions;
}

export interface IngestDeps {
  supabase: SupabaseClient;
  embed: EmbedFn;
}

export interface IngestResult {
  documentId: string;
  chunkCount: number;
}

/** Ekstrak dan potong tanpa menyentuh database/API (dipakai juga untuk dry-run). */
export async function prepareChunks(params: Omit<IngestParams, "meta">): Promise<ChunkDraft[]> {
  const blocks = await extractBlocks(params.buffer, params.kind);
  const chunks = chunkBlocks(blocks, params.chunkOptions);
  if (chunks.length === 0) throw new IngestError("Tidak ada teks yang bisa diproses dari dokumen ini.");
  return chunks;
}

export async function ingestDocument(params: IngestParams, deps: IngestDeps): Promise<IngestResult> {
  const chunks = await prepareChunks(params);

  // Embedding dibuat sebelum menulis ke DB, agar kegagalan API tidak meninggalkan data setengah jadi.
  const vectors = await deps.embed(
    chunks.map((c) => embeddingText(params.meta.title, c.heading_path, c.content)),
    "document",
  );
  if (vectors.length !== chunks.length) throw new Error("Jumlah embedding tidak sama dengan jumlah chunk.");

  const { data: doc, error: docErr } = await deps.supabase
    .from("documents")
    .insert({
      title: params.meta.title,
      doc_type: params.meta.doc_type,
      doc_number: params.meta.doc_number,
      effective_date: params.meta.effective_date,
      status: params.meta.status ?? "aktif",
      file_path: params.meta.file_path ?? null,
    })
    .select("id")
    .single();
  if (docErr || !doc) throw new Error(`Gagal menyimpan dokumen: ${docErr?.message}`);

  const rows = chunks.map((c, i) => ({
    document_id: doc.id,
    heading_path: c.heading_path,
    content: c.content,
    chunk_order: c.chunk_order,
    embedding: JSON.stringify(vectors[i]), // pgvector menerima format teks "[0.1,0.2,...]"
  }));
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const { error: chunkErr } = await deps.supabase.from("chunks").insert(rows.slice(i, i + INSERT_BATCH));
    if (chunkErr) {
      // Rollback sederhana: menghapus dokumen ikut menghapus chunk-nya (on delete cascade).
      await deps.supabase.from("documents").delete().eq("id", doc.id);
      throw new Error(`Gagal menyimpan chunk: ${chunkErr.message}`);
    }
  }
  return { documentId: doc.id, chunkCount: chunks.length };
}
