-- ============================================================
-- Fatawa Bot: Supabase Migration 001
-- Run this in your Supabase SQL Editor before first use.
-- ============================================================

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Create the fataawa table
create table if not exists fataawa (
  id                       bigserial primary key,
  category                 text        not null,
  raw_question             text        not null unique,
  shaikh_answer            text        not null,
  embedding                vector(1536),
  historical_frequency_count int       not null default 1,
  confidence_score         float       not null default 1.0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- 3. HNSW index for fast approximate cosine nearest-neighbor search
--    ef_construction=128 gives a good quality/speed tradeoff
create index if not exists fataawa_embedding_hnsw_idx
  on fataawa
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 128);

-- 4. GIN index on category for filtered queries
create index if not exists fataawa_category_idx on fataawa (category);

-- 5. RPC: Cosine similarity search
create or replace function match_fataawa(
  query_embedding  vector(1536),
  match_threshold  float,
  match_count      int
)
returns table (
  id                         bigint,
  category                   text,
  raw_question               text,
  shaikh_answer              text,
  historical_frequency_count int,
  confidence_score           float,
  similarity                 float
)
language sql
stable
as $$
  select
    f.id,
    f.category,
    f.raw_question,
    f.shaikh_answer,
    f.historical_frequency_count,
    f.confidence_score,
    1 - (f.embedding <=> query_embedding) as similarity
  from   fataawa f
  where  1 - (f.embedding <=> query_embedding) > match_threshold
  order  by f.embedding <=> query_embedding
  limit  match_count;
$$;

-- 6. RPC: Category-filtered similarity search
create or replace function match_fataawa_by_category(
  query_embedding  vector(1536),
  filter_category  text,
  match_threshold  float,
  match_count      int
)
returns table (
  id                         bigint,
  category                   text,
  raw_question               text,
  shaikh_answer              text,
  historical_frequency_count int,
  confidence_score           float,
  similarity                 float
)
language sql
stable
as $$
  select
    f.id,
    f.category,
    f.raw_question,
    f.shaikh_answer,
    f.historical_frequency_count,
    f.confidence_score,
    1 - (f.embedding <=> query_embedding) as similarity
  from   fataawa f
  where  f.category = filter_category
    and  1 - (f.embedding <=> query_embedding) > match_threshold
  order  by f.embedding <=> query_embedding
  limit  match_count;
$$;

-- 7. Auto-update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger fataawa_updated_at
  before update on fataawa
  for each row
  execute procedure update_updated_at_column();

-- 8. Row-Level Security (disable for service role, enable for anon)
alter table fataawa enable row level security;

-- Allow full access via service role key (used by the bot server)
create policy "service_role_all" on fataawa
  for all
  using (true)
  with check (true);
