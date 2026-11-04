// Memasukkan seluruh dokumen fiktif ke Supabase.
//   npm run ingest:demo            → ingest sungguhan (butuh .env.local)
//   npm run ingest:demo -- --dry-run → hanya ekstrak + chunk, tanpa API/DB
import "./load-env";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEMO_DOCS_DIR, loadDemoSources } from "../lib/ingest/demo-source";
import { createVoyageEmbedder } from "../lib/ingest/embed";
import { ingestDocument, prepareChunks } from "../lib/ingest/pipeline";
import { createAdminClient } from "../lib/supabase/admin";

const BUCKET = "documents";
const dryRun = process.argv.includes("--dry-run");

async function main() {
  const sources = loadDemoSources();
  const docxPath = (slug: string) => path.join(DEMO_DOCS_DIR, "docx", `${slug}.docx`);
  const missing = sources.filter((s) => !existsSync(docxPath(s.slug)));
  if (missing.length) {
    throw new Error(`File .docx belum ada untuk: ${missing.map((m) => m.slug).join(", ")}. Jalankan "npm run docs:build".`);
  }

  if (dryRun) {
    let total = 0;
    for (const src of sources) {
      const chunks = await prepareChunks({ buffer: readFileSync(docxPath(src.slug)), kind: "docx" });
      total += chunks.length;
      const longest = Math.max(...chunks.map((c) => c.content.length));
      console.log(`✓ ${src.meta.title}: ${chunks.length} chunk (terpanjang ${longest} karakter)`);
    }
    console.log(`\nDry-run selesai: ${sources.length} dokumen, ${total} chunk. Tidak ada data yang dikirim.`);
    return;
  }

  const supabase = createAdminClient();
  const embed = createVoyageEmbedder((m) => console.log(m));
  let total = 0;

  for (const src of sources) {
    const buffer = readFileSync(docxPath(src.slug));
    const filePath = `demo/${src.slug}.docx`;

    // Idempoten: hapus versi demo sebelumnya dengan nomor dokumen yang sama (chunk ikut terhapus).
    const { error: delErr } = await supabase.from("documents").delete().eq("doc_number", src.meta.doc_number);
    if (delErr) throw new Error(`Gagal menghapus versi lama ${src.meta.doc_number}: ${delErr.message}`);

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(filePath, buffer, {
      upsert: true,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    if (upErr) throw new Error(`Gagal upload ke Storage (${filePath}): ${upErr.message}. Sudah menjalankan 0002_storage.sql?`);

    const result = await ingestDocument(
      { buffer, kind: "docx", meta: { ...src.meta, status: "aktif", file_path: filePath } },
      { supabase, embed },
    );
    total += result.chunkCount;
    console.log(`✓ ${src.meta.title}: ${result.chunkCount} chunk`);
  }
  console.log(`\nSelesai: ${sources.length} dokumen, ${total} chunk tersimpan.`);
}

main().catch((err) => {
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
