-- FireSentry Karhutla — schema database EWS
-- Jalankan di Supabase SQL Editor setelah membuat project.
-- Service role key HANYA dipakai oleh GitHub Actions/server, JANGAN dimasukkan ke frontend.

create extension if not exists pgcrypto;

create table if not exists public.ews_status_current (
  kecamatan text primary key,
  risiko text not null check (risiko in ('Rendah','Sedang','Tinggi')),
  suhu numeric,
  kelembapan numeric,
  hotspot integer not null default 0,
  waktu_cek timestamptz not null,
  sumber text not null default 'BMKG + NASA FIRMS',
  updated_at timestamptz not null default now(),
  fdrs_ffmc numeric,
  fdrs_fwi numeric,
  fdrs_numeric_available boolean not null default false,
  fdrs_source text
);

create table if not exists public.ews_alerts (
  id uuid primary key default gen_random_uuid(),
  kecamatan text not null,
  dari_risiko text not null check (dari_risiko in ('Rendah','Sedang','Tinggi')),
  ke_risiko text not null check (ke_risiko in ('Sedang','Tinggi')),
  suhu numeric,
  kelembapan numeric,
  hotspot integer not null default 0,
  terdeteksi_pada timestamptz not null,
  telegram_terkirim boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.ews_runs (
  id uuid primary key default gen_random_uuid(),
  mulai_pada timestamptz not null,
  selesai_pada timestamptz,
  status text not null check (status in ('berhasil','sebagian','gagal')),
  kecamatan_gagal text[] not null default '{}',
  sumber text not null default 'GitHub Actions'
);

create index if not exists idx_ews_alerts_terdeteksi on public.ews_alerts (terdeteksi_pada desc);
create index if not exists idx_ews_status_risiko on public.ews_status_current (risiko);

-- RLS: tabel tidak boleh dibaca publik sampai policy yang sesuai dibuat.
alter table public.ews_status_current enable row level security;
alter table public.ews_alerts enable row level security;
alter table public.ews_runs enable row level security;

-- Jika frontend nantinya membaca status langsung dari Supabase, buat policy SELECT
-- hanya untuk anon/authenticated sesuai kebutuhan BPBD. Jangan pernah expose service role key.
