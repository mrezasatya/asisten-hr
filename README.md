# TanyaHR

Asisten web berbasis RAG untuk menjawab pertanyaan karyawan tentang Peraturan Perusahaan, kebijakan, SOP, dan memo internal, lengkap dengan sitasi pasal.

> **Demo portofolio.** Semua dokumen adalah dokumen fiktif milik perusahaan fiktif **PT Demo Rekayasa Indonesia** dan bukan rujukan hukum.

Status: **Fase 1 — Fondasi & Dokumen Fiktif**. Lihat `CLAUDE.md` dan `PRD-TanyaHR.md`.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Server pengembangan (http://localhost:3000) |
| `npm test` | Unit test (chunking, ekstraksi, embedding) — tanpa API key |
| `npm run typecheck` / `npm run lint` | Pemeriksaan kode |
| `npm run docs:build` | Membuat `.docx` dari sumber Markdown di `data/demo-docs/` |
| `npm run ingest:demo -- --dry-run` | Ekstrak + chunk semua dokumen demo **tanpa** API/DB |
| `npm run ingest:demo` | Ingest sungguhan ke Supabase (butuh `.env.local`) |
| `npm run check:chunks` | 10 chunk acak dari database (`-- --local` = dari chunking lokal, `-- --all` = semua) |

## Setup (semua layanan memakai paket gratis)

Kebutuhan: Node.js 20+ dan Git.

### 1. Ambil kode dan pasang dependensi

```bash
git clone https://github.com/mrezasatya/asisten-hr.git
```

```bash
cd asisten-hr && git checkout claude/nice-heisenberg-w6k9pq && npm install
```

Uji tanpa layanan apa pun:

```bash
npm test && npm run ingest:demo -- --dry-run
```

### 2. Supabase (database)

1. Daftar di https://supabase.com → **New project** (paket Free). Simpan kata sandi database.
2. Buka **SQL Editor** → **New query**. Buka file `supabase/migrations/0001_init.sql` (di editor teks atau di GitHub → tombol **Raw**), salin **seluruh isinya** (bukan nama filenya), tempel ke SQL Editor → **Run**. Hasil yang benar: *Success. No rows returned*.
3. Ulangi dengan **isi** file `supabase/migrations/0002_storage.sql`.
4. Buka **Project Settings → API**, salin: Project URL, `anon` key, dan `service_role` key.
5. **Authentication → Sign In / Providers → Email**: matikan *Allow new users to sign up* (akun admin dibuat manual di Fase 4).

### 3. Voyage AI (embedding)

1. Daftar di https://www.voyageai.com → dashboard → **API Keys** → buat key.
2. Tanpa metode pembayaran, rate limit bisa rendah. Skrip ingest sudah otomatis menunggu dan mencoba ulang, jadi ingest mungkin butuh beberapa menit.

### 4. Isi environment

```bash
cp .env.example .env.local
```

Isi `.env.local` dengan URL dan key dari langkah 2–3. **Jangan commit file ini** (sudah diabaikan oleh `.gitignore`).

### 5. Ingest dan periksa

```bash
npm run ingest:demo
```

```bash
npm run check:chunks
```

Hasil yang diharapkan: 10 dokumen, ±131 chunk, dan 10 chunk acak yang terpotong rapi per Pasal/Langkah.

## Cara kerja ingest (ringkas)

```
.docx / PDF ──► ekstraksi (mammoth / unpdf) ──► daftar heading + paragraf
           ──► chunking per Bab > Pasal / Bagian > Langkah (pasal panjang dipecah per ayat)
           ──► embedding Voyage (judul + heading_path + isi)
           ──► Supabase: documents + chunks (tsvector dibuat otomatis oleh Postgres)
```

PDF tanpa teks (hasil scan) ditolak dengan pesan *"Dokumen hasil scan belum didukung."*
