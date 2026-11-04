// Embedding via Voyage AI REST API (tanpa SDK).
// Akun Voyage tanpa metode pembayaran bisa mendapat rate limit rendah, sehingga request
// dikirim per batch kecil dan diulang otomatis saat terkena 429.
import { embeddingConfig } from "../config/env";

export type InputType = "document" | "query";
export type EmbedFn = (texts: string[], inputType: InputType) => Promise<number[][]>;

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MAX_TOKENS_PER_REQUEST = 8000; // perkiraan konservatif
const MAX_INPUTS_PER_REQUEST = 64;
const MAX_RETRIES = 6;

/** Perkiraan kasar token: Bahasa Indonesia ≈ 3 karakter per token. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3);

export function makeBatches(texts: string[]): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let tokens = 0;
  for (const t of texts) {
    const n = estimateTokens(t);
    if (batch.length && (tokens + n > MAX_TOKENS_PER_REQUEST || batch.length >= MAX_INPUTS_PER_REQUEST)) {
      batches.push(batch);
      batch = [];
      tokens = 0;
    }
    batch.push(t);
    tokens += n;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
}

export function createVoyageEmbedder(
  log: (msg: string) => void = () => {},
  fetchImpl: typeof fetch = fetch,
): EmbedFn {
  const { apiKey, model, dimensions } = embeddingConfig();
  return async (texts, inputType) => {
    const out: number[][] = [];
    for (const batch of makeBatches(texts)) {
      for (let attempt = 0; ; attempt++) {
        const res = await fetchImpl(VOYAGE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ input: batch, model, input_type: inputType, output_dimension: dimensions }),
        });
        if (res.ok) {
          const json = (await res.json()) as VoyageResponse;
          const sorted = [...json.data].sort((a, b) => a.index - b.index);
          for (const d of sorted) {
            if (d.embedding.length !== dimensions) {
              throw new Error(
                `Dimensi embedding ${d.embedding.length} ≠ EMBEDDING_DIMENSIONS ${dimensions}. Samakan dengan kolom vector di migrasi.`,
              );
            }
            out.push(d.embedding);
          }
          break;
        }
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= MAX_RETRIES) {
          const body = await res.text().catch(() => "");
          throw new Error(`Voyage API gagal (HTTP ${res.status}): ${body.slice(0, 300)}`);
        }
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 5_000 * 2 ** attempt);
        log(`  Voyage HTTP ${res.status}, coba lagi dalam ${Math.round(wait / 1000)} detik...`);
        await sleep(wait);
      }
    }
    return out;
  };
}

/** Teks yang di-embed: judul dokumen + heading path + isi, agar konteks pasal ikut terwakili. */
export const embeddingText = (docTitle: string, headingPath: string, content: string) =>
  `${docTitle}\n${headingPath}\n\n${content}`;
