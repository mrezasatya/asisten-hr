-- TanyaHR — bucket Storage privat untuk file asli dokumen.
-- Jalankan setelah 0001_init.sql. Tidak ada policy untuk anon/authenticated di sini;
-- upload dilakukan oleh server/skrip dengan service role. Akses admin ditambahkan di Fase 4.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;
