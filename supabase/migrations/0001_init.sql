-- TanyaHR — skema awal (Fase 1)
-- Jalankan di Supabase: SQL Editor → tempel isi file ini → Run.
-- Dimensi vektor 1024 = default Voyage AI `voyage-4`. Jika EMBEDDING_DIMENSIONS diubah,
-- ubah juga vector(1024) di bawah lalu ingest ulang semua dokumen.

create extension if not exists vector;

-- ---------------------------------------------------------------------------
-- documents: satu baris per dokumen (versi) yang diunggah
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  doc_type       text not null check (doc_type in ('PP', 'KEBIJAKAN', 'SOP', 'MEMO')),
  doc_number     text,
  effective_date date,
  status         text not null default 'aktif' check (status in ('aktif', 'nonaktif')),
  file_path      text,
  uploaded_at    timestamptz not null default now()
);

create index if not exists documents_status_idx on public.documents (status);

-- ---------------------------------------------------------------------------
-- chunks: potongan dokumen per pasal/ayat/langkah
-- ---------------------------------------------------------------------------
create table if not exists public.chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id) on delete cascade,
  heading_path text not null,                 -- mis. "Bab V > Pasal 12 > Ayat 2"
  content      text not null,
  embedding    vector(1024),
  -- 'simple' = tanpa stemming; tidak ada stemmer Bahasa Indonesia bawaan Postgres.
  tsv          tsvector generated always as (
                 to_tsvector('simple', coalesce(heading_path, '') || ' ' || coalesce(content, ''))
               ) stored,
  chunk_order  int not null
);

create index if not exists chunks_document_idx on public.chunks (document_id, chunk_order);
create index if not exists chunks_tsv_idx on public.chunks using gin (tsv);
create index if not exists chunks_embedding_idx on public.chunks
  using hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- query_logs: log tanya-jawab TANPA IP atau identitas pengguna
-- ---------------------------------------------------------------------------
create table if not exists public.query_logs (
  id                  uuid primary key default gen_random_uuid(),
  question_masked     text not null,
  retrieved_chunk_ids uuid[] not null default '{}',
  answer              text,
  status              text not null check (status in ('answered', 'not_found', 'personal', 'conflict')),
  latency_ms          int,
  created_at          timestamptz not null default now()
);

create index if not exists query_logs_created_idx on public.query_logs (created_at desc);
create index if not exists query_logs_status_idx on public.query_logs (status);

-- ---------------------------------------------------------------------------
-- feedback: 👍 (+1) / 👎 (-1) per jawaban
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id           uuid primary key default gen_random_uuid(),
  query_log_id uuid not null references public.query_logs (id) on delete cascade,
  rating       smallint not null check (rating in (-1, 1)),
  created_at   timestamptz not null default now()
);

create index if not exists feedback_query_log_idx on public.feedback (query_log_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Pengunjung anonim TIDAK punya akses langsung ke tabel mana pun; semua akses publik
-- lewat API route server (service role, yang memang melewati RLS).
-- User yang login (akun admin dibuat manual di Supabase Auth) boleh membaca semua tabel
-- dan mengelola dokumen.
-- ---------------------------------------------------------------------------
alter table public.documents  enable row level security;
alter table public.chunks     enable row level security;
alter table public.query_logs enable row level security;
alter table public.feedback   enable row level security;

drop policy if exists "admin kelola documents" on public.documents;
create policy "admin kelola documents" on public.documents
  for all to authenticated using (true) with check (true);

drop policy if exists "admin kelola chunks" on public.chunks;
create policy "admin kelola chunks" on public.chunks
  for all to authenticated using (true) with check (true);

drop policy if exists "admin baca query_logs" on public.query_logs;
create policy "admin baca query_logs" on public.query_logs
  for select to authenticated using (true);

drop policy if exists "admin baca feedback" on public.feedback;
create policy "admin baca feedback" on public.feedback
  for select to authenticated using (true);
