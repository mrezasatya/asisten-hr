// Menampilkan 10 chunk acak beserta heading_path untuk pengecekan manual.
//   npm run check:chunks              → dari database Supabase
//   npm run check:chunks -- --local   → dari hasil chunking lokal (tanpa DB)
//   tambahkan --all untuk menampilkan semua chunk, --n=20 untuk jumlah lain
import "./load-env";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEMO_DOCS_DIR, loadDemoSources } from "../lib/ingest/demo-source";
import { prepareChunks } from "../lib/ingest/pipeline";
import { createAdminClient } from "../lib/supabase/admin";

interface Row {
  title: string;
  heading_path: string;
  content: string;
}

const args = process.argv.slice(2);
const local = args.includes("--local");
const all = args.includes("--all");
const n = Number(args.find((a) => a.startsWith("--n="))?.slice(4) ?? 10);

function sample<T>(arr: T[], k: number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

async function loadLocal(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const src of loadDemoSources()) {
    const buffer = readFileSync(path.join(DEMO_DOCS_DIR, "docx", `${src.slug}.docx`));
    for (const c of await prepareChunks({ buffer, kind: "docx" })) {
      rows.push({ title: src.meta.title, heading_path: c.heading_path, content: c.content });
    }
  }
  return rows;
}

async function loadDb(): Promise<Row[]> {
  const { data, error } = await createAdminClient()
    .from("chunks")
    .select("heading_path, content, chunk_order, documents(title)")
    .order("chunk_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    title: (r.documents as unknown as { title: string } | null)?.title ?? "?",
    heading_path: r.heading_path,
    content: r.content,
  }));
}

async function main() {
  const rows = local ? await loadLocal() : await loadDb();
  const picked = all ? rows : sample(rows, n);
  console.log(`Sumber: ${local ? "chunking lokal" : "database"} — menampilkan ${picked.length} dari ${rows.length} chunk\n`);
  for (const r of picked) {
    console.log(`━━ ${r.title}\n   ${r.heading_path}  (${r.content.length} karakter)`);
    const preview = r.content.length > 400 ? `${r.content.slice(0, 200)} … ${r.content.slice(-150)}` : r.content;
    console.log(preview.replace(/^/gm, "   │ "));
    console.log();
  }
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
