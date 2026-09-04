-- ============================================================================
-- 小学知识成长地图 PWA · Supabase 云端 schema
-- ----------------------------------------------------------------------------
-- 对应 src/types/user.ts 的全部用户数据表（内容数据一条都不存，见 Implementation_Plan 第 64/85 行）。
-- 设计原则：
--   1. 所有表以「家长」为数据owner；children.parent_id = auth.uid()（文本化 uuid）。
--   2. 子表（weekly_reviews 等）只存 child_id，RLS 通过 exists 子查询回查 children 归属。
--   3. 列名/类型与 IndexedDB（storageService）及 TS 类型一致，保证 syncService upsert 零转换。
--   4. 内容数据（subjects/knowledge/resources）永不进 Supabase。
--   5. 应用方式：Supabase 控制台 SQL Editor 粘贴执行，或 `supabase db push`。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 扩展（uuid 生成，auth.users 已存在则无需）
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles：家长档案（auth.users 的 1:1 投影）
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- children：孩子档案
-- ---------------------------------------------------------------------------
create table if not exists public.children (
  id          text primary key,
  parent_id   text not null,           -- = auth.uid()::text
  name        text not null,
  avatar      text not null default '🧒',
  grade       text not null default '一年级',
  school_year text not null default '2026',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sync_state  text not null default 'pending'  -- pending|syncing|synced|failed
);

-- ---------------------------------------------------------------------------
-- weekly_reviews：每周复盘
-- ---------------------------------------------------------------------------
create table if not exists public.weekly_reviews (
  id           text primary key,
  child_id     text not null references public.children (id) on delete cascade,
  week_start   text not null,          -- ISO 周一，如 2026-08-31
  week_end     text not null,
  week_no      integer not null default 0,
  review_date  text not null,
  status       text not null default 'in_progress',  -- in_progress|completed|skipped
  is_backfill  boolean not null default false,
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  sync_state   text not null default 'pending'
);

-- ---------------------------------------------------------------------------
-- review_items：复盘条目（永远【追加】，绝不覆盖/删除历史）
-- ---------------------------------------------------------------------------
create table if not exists public.review_items (
  id              text primary key,
  review_id       text not null references public.weekly_reviews (id) on delete cascade,
  child_id        text not null,
  knowledge_id    text not null,       -- Stable ID，绝不存名称
  child_rating    text,                -- bad2|bad1|good1|good2
  parent_rating   text,                -- mastered|basic|needs_review|focus
  knowledge_status text not null default 'unreviewed',  -- unreviewed|mastered|basic|needs_review|focus
  note            text not null default '',
  review_count    integer not null default 1,
  next_review_date text,
  content_version text not null default '1.0',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  sync_state      text not null default 'pending'
);

-- ---------------------------------------------------------------------------
-- progress_checkins：实际学习进度确认（V1.1 新增）
-- ---------------------------------------------------------------------------
create table if not exists public.progress_checkins (
  id             text primary key,
  child_id       text not null,
  week_start     text not null,
  subject_id     text not null,
  actual_unit_id text,                 -- Stable ID，可空
  delta_type     text,                 -- on_pace|ahead|behind|no_class
  confirmed_at   timestamptz not null default now(),
  sync_state     text not null default 'pending'
);

-- ---------------------------------------------------------------------------
-- assessments：考试记录
-- ---------------------------------------------------------------------------
create table if not exists public.assessments (
  id           text primary key,
  child_id     text not null,
  subject_id   text not null,
  exam_type    text not null default '',
  exam_date    text not null,
  score        numeric not null default 0,
  full_score   numeric not null default 0,
  semester     text not null default '',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  sync_state   text not null default 'pending'
);

-- ---------------------------------------------------------------------------
-- growth_records：成长时间轴事件
-- ---------------------------------------------------------------------------
create table if not exists public.growth_records (
  id           text primary key,
  child_id     text not null,
  type         text not null,          -- map_progress|knowledge|weekly_review|assessment|audio|note|milestone|skip
  title        text not null default '',
  description  text not null default '',
  record_date  text not null,
  knowledge_id text,
  is_backfill  boolean not null default false,
  grade        text,
  metadata     jsonb,
  created_at   timestamptz not null default now(),
  sync_state   text not null default 'pending'
);

-- ---------------------------------------------------------------------------
-- audio_records：录音元数据（Blob 本体存 Storage，不存表内）
-- ---------------------------------------------------------------------------
create table if not exists public.audio_records (
  id            text primary key,
  child_id      text not null,
  knowledge_id  text,
  storage_path  text not null default '',  -- 形如 <parent_id>/<audio_id>.webm
  duration      numeric not null default 0,
  created_at    timestamptz not null default now(),
  sync_state    text not null default 'pending'
);

-- ===========================================================================
-- 索引（与 storageService 的 Dexie 索引一一对应，保证拉取/查询效率）
-- ===========================================================================
create index if not exists idx_children_parent      on public.children (parent_id);
create index if not exists idx_wr_child              on public.weekly_reviews (child_id);
create index if not exists idx_wr_child_week         on public.weekly_reviews (child_id, week_start);
create index if not exists idx_ri_child              on public.review_items (child_id);
create index if not exists idx_ri_review             on public.review_items (review_id);
create index if not exists idx_ri_knowledge          on public.review_items (knowledge_id);
create index if not exists idx_pci_child_week        on public.progress_checkins (child_id, week_start);
create index if not exists idx_assess_child          on public.assessments (child_id);
create index if not exists idx_gr_child              on public.growth_records (child_id);
create index if not exists idx_gr_record_date        on public.growth_records (record_date);
create index if not exists idx_ar_child              on public.audio_records (child_id);

-- ===========================================================================
-- Row Level Security —— 家长只能碰自己的孩子数据
-- ===========================================================================
alter table public.profiles           enable row level security;
alter table public.children            enable row level security;
alter table public.weekly_reviews      enable row level security;
alter table public.review_items        enable row level security;
alter table public.progress_checkins   enable row level security;
alter table public.assessments         enable row level security;
alter table public.growth_records      enable row level security;
alter table public.audio_records       enable row level security;

-- profiles：只能看/改自己
create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- children：parent_id 直接等于当前用户
create policy "own children" on public.children
  for all using (parent_id = auth.uid()::text)
  with check (parent_id = auth.uid()::text);

-- 子表统一用 exists 子查询回查归属（不冗余存 parent_id）
create policy "review owner" on public.weekly_reviews
  for all using (exists (select 1 from public.children c where c.id = weekly_reviews.child_id and c.parent_id = auth.uid()::text))
  with check (exists (select 1 from public.children c where c.id = weekly_reviews.child_id and c.parent_id = auth.uid()::text));

create policy "review item owner" on public.review_items
  for all using (exists (select 1 from public.children c where c.id = review_items.child_id and c.parent_id = auth.uid()::text))
  with check (exists (select 1 from public.children c where c.id = review_items.child_id and c.parent_id = auth.uid()::text));

create policy "checkin owner" on public.progress_checkins
  for all using (exists (select 1 from public.children c where c.id = progress_checkins.child_id and c.parent_id = auth.uid()::text))
  with check (exists (select 1 from public.children c where c.id = progress_checkins.child_id and c.parent_id = auth.uid()::text));

create policy "assessment owner" on public.assessments
  for all using (exists (select 1 from public.children c where c.id = assessments.child_id and c.parent_id = auth.uid()::text))
  with check (exists (select 1 from public.children c where c.id = assessments.child_id and c.parent_id = auth.uid()::text));

create policy "growth owner" on public.growth_records
  for all using (exists (select 1 from public.children c where c.id = growth_records.child_id and c.parent_id = auth.uid()::text))
  with check (exists (select 1 from public.children c where c.id = growth_records.child_id and c.parent_id = auth.uid()::text));

create policy "audio owner" on public.audio_records
  for all using (exists (select 1 from public.children c where c.id = audio_records.child_id and c.parent_id = auth.uid()::text))
  with check (exists (select 1 from public.children c where c.id = audio_records.child_id and c.parent_id = auth.uid()::text));

-- ===========================================================================
-- Storage：录音 bucket（私有，按 parent_id 目录隔离）
-- 录音文件命名约定：<parent_id>/<audio_id>.webm
-- ===========================================================================
insert into storage.buckets (id, name, public)
values ('audio', 'audio', false)
on conflict (id) do nothing;

create policy "own audio files" on storage.objects
  for all using (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'audio'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ===========================================================================
-- 触发器：自动维护 updated_at（可选，应用层已写，这里兜底）
-- ===========================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger trg_children_updated before update on public.children
  for each row execute function public.set_updated_at();
create or replace trigger trg_wr_updated before update on public.weekly_reviews
  for each row execute function public.set_updated_at();
create or replace trigger trg_ri_updated before update on public.review_items
  for each row execute function public.set_updated_at();
create or replace trigger trg_assess_updated before update on public.assessments
  for each row execute function public.set_updated_at();
