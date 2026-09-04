/**
 * User Data Service —— 用户数据的统一接口。
 *
 * 开发总 Prompt 第 61 节：页面只调用这里的方法，不直接碰 IndexedDB / Supabase（第 59 节）。
 *
 * 三条硬约束：
 *   1. 先写 IndexedDB 立即返回，绝不因为网络阻塞用户操作（第 33 节 Offline First）
 *   2. review_items 永远「追加」，review_count + 1，绝不覆盖或删除历史（V1.1 Handoff Notes）
 *   3. 只存 Stable ID（knowledge_id / unit_id），绝不存名称（第 11、12 节）
 */
import * as db from './storageService';
import { contentService } from './contentService';
import { addWeeks, todayISO, weekRange } from '@/utils/date';
import type {
  Assessment,
  Child,
  ChildRating,
  GrowthRecord,
  GrowthRecordType,
  KnowledgeStatus,
  ParentRating,
  ProgressCheckIn,
  ReviewItem,
  ReviewStatus,
  SyncState,
  WeeklyReview,
} from '@/types/user';

/** 本地模式下的家长 ID。接入 Supabase 后替换为 auth.uid()。 */
export const LOCAL_PARENT_ID = 'local_parent';

export const AVATARS = ['🧒', '👦', '👧', '🧑', '👶', '🐯', '🐰', '🦊', '🐼', '🌟'];

// ------------------------------------------------------------------ 缓存

let childrenCache: Child[] | null = null;
let itemsCache: Map<string, ReviewItem[]> | null = null; // child_id -> items
const invalidate = () => {
  childrenCache = null;
  itemsCache = null;
};

// ------------------------------------------------------------------ 孩子

export async function getChildren(): Promise<Child[]> {
  if (!childrenCache) {
    const all = await db.getAll('children');
    childrenCache = all.filter((c) => c.parent_id === LOCAL_PARENT_ID).sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  return childrenCache;
}

export async function getChild(id: string): Promise<Child | undefined> {
  return (await getChildren()).find((c) => c.id === id);
}

export async function createChild(input: { name: string; grade: string; school_year: string; avatar?: string }): Promise<Child> {
  const now = new Date().toISOString();
  const existing = await getChildren();
  const child: Child = {
    id: db.uid('ch'),
    parent_id: LOCAL_PARENT_ID,
    name: input.name.trim() || '小朋友',
    avatar: input.avatar || AVATARS[existing.length % AVATARS.length],
    grade: input.grade,
    school_year: input.school_year,
    created_at: now,
    updated_at: now,
    sync_state: 'pending',
  };
  await db.put('children', child);
  invalidate();
  // 第一次有孩子 = 踏上小学成长旅程的第一步
  if (existing.length === 0) {
    await createGrowthRecord({
      child_id: child.id,
      type: 'milestone',
      title: '踏上小学成长旅程的第一步',
      description: `${child.name}的成长地图已经打开，慢慢走。`,
      record_date: todayISO(),
      grade: child.grade,
    });
  }
  return child;
}

export async function updateChild(id: string, patch: Partial<Pick<Child, 'name' | 'grade' | 'avatar' | 'school_year'>>): Promise<Child | undefined> {
  const c = await db.get('children', id);
  if (!c) return undefined;
  const next: Child = { ...c, ...patch, updated_at: new Date().toISOString(), sync_state: 'pending' };
  await db.put('children', next);
  invalidate();
  return next;
}

export async function deleteChild(id: string): Promise<void> {
  const [reviews, items, checkins, assessments, records] = await Promise.all([
    db.getAll('weekly_reviews'),
    db.getAll('review_items'),
    db.getAll('progress_checkins'),
    db.getAll('assessments'),
    db.getAll('growth_records'),
  ]);
  await Promise.all([
    db.removeMany('weekly_reviews', reviews.filter((r) => r.child_id === id).map((r) => r.id)),
    db.removeMany('review_items', items.filter((r) => r.child_id === id).map((r) => r.id)),
    db.removeMany('progress_checkins', checkins.filter((r) => r.child_id === id).map((r) => r.id)),
    db.removeMany('assessments', assessments.filter((r) => r.child_id === id).map((r) => r.id)),
    db.removeMany('growth_records', records.filter((r) => r.child_id === id).map((r) => r.id)),
  ]);
  await db.remove('children', id);
  invalidate();
}

// ------------------------------------------------------------------ 周复盘

/** 取（或新建）某孩子某一周的复盘。支持补录过去的周。 */
export async function getOrCreateReview(childId: string, weekStart: string, isBackfill = false): Promise<WeeklyReview> {
  const all = await db.getAll('weekly_reviews');
  const found = all.find((r) => r.child_id === childId && r.week_start === weekStart);
  if (found) return found;

  const wr = weekRange(new Date(`${weekStart}T00:00:00`));
  const now = new Date().toISOString();
  const review: WeeklyReview = {
    id: db.uid('rev'),
    child_id: childId,
    week_start: wr.week_start,
    week_end: wr.week_end,
    week_no: wr.week_no,
    review_date: isBackfill ? wr.week_end : todayISO(),
    status: 'in_progress',
    is_backfill: isBackfill,
    note: '',
    created_at: now,
    updated_at: now,
    completed_at: null,
    sync_state: 'pending',
  };
  await db.put('weekly_reviews', review);
  return review;
}

export async function getReviews(childId: string): Promise<WeeklyReview[]> {
  const all = await db.getAll('weekly_reviews');
  return all
    .filter((r) => r.child_id === childId)
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
}

export async function setReviewStatus(reviewId: string, status: ReviewStatus, note = ''): Promise<void> {
  const r = await db.get('weekly_reviews', reviewId);
  if (!r) return;
  const now = new Date().toISOString();
  await db.put('weekly_reviews', {
    ...r,
    status,
    note: note || r.note,
    completed_at: status === 'completed' ? now : r.completed_at,
    updated_at: now,
    sync_state: 'pending',
  });
}

// ------------------------------------------------------------------ 复盘条目

export interface SaveReviewItemInput {
  child_id: string;
  review_id: string;
  knowledge_id: string;
  child_rating: ChildRating | null;
  parent_rating: ParentRating | null;
  knowledge_status: KnowledgeStatus;
  note?: string;
  /** 家长选了「下周再看看」时给出建议复核日 */
  next_review_date?: string | null;
}

/**
 * 保存一条复核记录。
 * 永远是「追加」：生成新的 review_item，review_count = 已有次数 + 1。
 * 旧的记录一条都不动 —— 这样 KnowledgeCard 才能展示「怎么变好的」。
 */
export async function saveReviewItem(input: SaveReviewItemInput): Promise<ReviewItem> {
  const items = await getReviewItems(input.child_id);
  const prevCount = items
    .filter((i) => i.knowledge_id === input.knowledge_id)
    .reduce((max, i) => Math.max(max, i.review_count || 0), 0);

  const now = new Date().toISOString();
  const item: ReviewItem = {
    id: db.uid('ri'),
    review_id: input.review_id,
    child_id: input.child_id,
    knowledge_id: input.knowledge_id,
    child_rating: input.child_rating,
    parent_rating: input.parent_rating,
    knowledge_status: input.knowledge_status,
    note: input.note || '',
    review_count: prevCount + 1,
    next_review_date: input.next_review_date ?? nextReviewDateFor(input.knowledge_status),
    content_version: contentService.getContentVersion(),
    created_at: now,
    updated_at: now,
    sync_state: 'pending',
  };
  await db.put('review_items', item);
  invalidate();
  return item;
}

/**
 * 更新同一次复盘内的条目（家长回头改主意）。
 * 注意与 saveReviewItem 的区别：
 *   - 同一 review_id 内修改 → 更新本条，不新增（同一次复核就是同一次判断）
 *   - 跨周复核 / ResourceSupport 重新确认 → 必须 saveReviewItem 追加，review_count + 1
 */
export async function updateReviewItem(
  itemId: string,
  patch: Partial<Pick<ReviewItem, 'child_rating' | 'parent_rating' | 'knowledge_status' | 'note' | 'next_review_date'>>
): Promise<void> {
  const it = await db.get('review_items', itemId);
  if (!it) return;
  await db.put('review_items', {
    ...it,
    ...patch,
    next_review_date:
      patch.next_review_date !== undefined ? patch.next_review_date : nextReviewDateFor(patch.knowledge_status ?? it.knowledge_status),
    updated_at: new Date().toISOString(),
    sync_state: 'pending',
  });
  invalidate();
}

/** 某次复盘里已经评过的条目（key = knowledge_id） */
export async function getReviewItemsMap(reviewId: string): Promise<Map<string, ReviewItem>> {
  const items = await getReviewItemsByReview(reviewId);
  const m = new Map<string, ReviewItem>();
  for (const it of items) {
    const prev = m.get(it.knowledge_id);
    if (!prev || it.created_at >= prev.created_at) m.set(it.knowledge_id, it);
  }
  return m;
}

/** 异常项默认下周再复核一次；正常项不排期 */
function nextReviewDateFor(status: KnowledgeStatus): string | null {
  if (status === 'needs_review' || status === 'focus') return addWeeks(weekRange().week_start, 1).week_start;
  return null;
}

/** 某孩子的全部复盘条目，按时间升序 */
export async function getReviewItems(childId: string): Promise<ReviewItem[]> {
  if (!itemsCache) itemsCache = new Map();
  if (!itemsCache.has(childId)) {
    const all = await db.getAll('review_items');
    itemsCache.set(
      childId,
      all.filter((i) => i.child_id === childId).sort((a, b) => a.created_at.localeCompare(b.created_at))
    );
  }
  return itemsCache.get(childId)!;
}

export async function getReviewItemsByReview(reviewId: string): Promise<ReviewItem[]> {
  return db.getByIndex('review_items', 'review_id', reviewId);
}

export interface KnowledgeSnapshot {
  status: KnowledgeStatus;
  review_count: number;
  last_reviewed_at: string;
  child_rating: ChildRating | null;
  parent_rating: ParentRating | null;
}

/**
 * 批量取知识点的最新状态。
 * 返回「最新一条 review_item」的快照；没有任何记录则为 ⚪ 未复核（不是「不会」）。
 */
export async function getKnowledgeSnapshots(childId: string, knowledgeIds: string[]): Promise<Map<string, KnowledgeSnapshot>> {
  const items = await getReviewItems(childId);
  const want = new Set(knowledgeIds);
  const map = new Map<string, KnowledgeSnapshot>();
  for (const it of items) {
    if (!want.has(it.knowledge_id)) continue;
    const prev = map.get(it.knowledge_id);
    if (!prev || it.created_at >= prev.last_reviewed_at) {
      map.set(it.knowledge_id, {
        status: it.knowledge_status,
        review_count: it.review_count,
        last_reviewed_at: it.created_at,
        child_rating: it.child_rating,
        parent_rating: it.parent_rating,
      });
    }
  }
  return map;
}

/** 单个知识点的全部复核历史（时间线用） */
export async function getKnowledgeHistory(childId: string, knowledgeId: string): Promise<ReviewItem[]> {
  const items = await getReviewItems(childId);
  return items.filter((i) => i.knowledge_id === knowledgeId);
}

/** 需要关注的知识点（🟠/🔴），按 review_count 降序 + 严重度排序 */
export async function getAttentionItems(childId: string, limit = 3): Promise<ReviewItem[]> {
  const items = await getReviewItems(childId);
  const latest = new Map<string, ReviewItem>();
  for (const it of items) {
    const prev = latest.get(it.knowledge_id);
    if (!prev || it.created_at >= prev.created_at) latest.set(it.knowledge_id, it);
  }
  const weight: Record<string, number> = { focus: 2, needs_review: 1 };
  return [...latest.values()]
    .filter((i) => i.knowledge_status === 'focus' || i.knowledge_status === 'needs_review')
    .sort((a, b) => {
      const byCount = b.review_count - a.review_count;
      if (byCount !== 0) return byCount;
      return (weight[b.knowledge_status] || 0) - (weight[a.knowledge_status] || 0);
    })
    .slice(0, limit);
}

// ------------------------------------------------------------------ 进度确认

export async function saveProgressCheckIn(input: {
  child_id: string;
  week_start: string;
  subject_id: string;
  actual_unit_id: string | null;
  delta_type: ProgressCheckIn['delta_type'];
}): Promise<ProgressCheckIn> {
  const all = await db.getAll('progress_checkins');
  const found = all.find(
    (c) => c.child_id === input.child_id && c.week_start === input.week_start && c.subject_id === input.subject_id
  );
  if (found) {
    const next = { ...found, ...input, confirmed_at: new Date().toISOString(), sync_state: 'pending' as SyncState };
    await db.put('progress_checkins', next);
    return next;
  }
  const rec: ProgressCheckIn = {
    id: db.uid('pci'),
    ...input,
    confirmed_at: new Date().toISOString(),
    sync_state: 'pending',
  };
  await db.put('progress_checkins', rec);
  return rec;
}

export async function getCheckIns(childId: string): Promise<ProgressCheckIn[]> {
  const all = await db.getAll('progress_checkins');
  return all
    .filter((c) => c.child_id === childId)
    .sort((a, b) => a.confirmed_at.localeCompare(b.confirmed_at));
}

/** 孩子在各学科的最新一次进度确认 */
export async function getLatestCheckIn(childId: string, subjectId: string): Promise<ProgressCheckIn | null> {
  const all = await getCheckIns(childId);
  const hit = all.filter((c) => c.subject_id === subjectId);
  return hit.length ? hit[hit.length - 1] : null;
}

// ------------------------------------------------------------------ 考试

export async function createAssessment(
  input: Omit<Assessment, 'id' | 'created_at' | 'updated_at' | 'sync_state'>
): Promise<Assessment> {
  const now = new Date().toISOString();
  const rec: Assessment = { ...input, id: db.uid('as'), created_at: now, updated_at: now, sync_state: 'pending' };
  await db.put('assessments', rec);
  // 考试是成长里程碑，沉淀到时间轴（V1.1 Change 07）
  await createGrowthRecord({
    child_id: rec.child_id,
    type: 'assessment',
    title: `${input.exam_type} · ${rec.score}/${rec.full_score} 分`,
    description: input.note || `${contentService.getSubject(input.subject_id)?.map_name ?? '考试'} · ${rec.semester}`,
    record_date: input.exam_date,
    metadata: { assessment_id: rec.id, subject_id: input.subject_id },
  });
  return rec;
}

export async function getAssessments(childId: string): Promise<Assessment[]> {
  const all = await db.getAll('assessments');
  return all.filter((a) => a.child_id === childId).sort((a, b) => b.exam_date.localeCompare(a.exam_date));
}

// ------------------------------------------------------------------ 成长记录

export async function createGrowthRecord(input: {
  child_id: string;
  type: GrowthRecordType;
  title: string;
  description: string;
  record_date: string;
  knowledge_id?: string | null;
  is_backfill?: boolean;
  grade?: string;
  metadata?: Record<string, unknown> | null;
}): Promise<GrowthRecord> {
  // 年级用于时间轴按"小学六年"分年；未显式传入时按孩子当前年级兜底
  const grade = input.grade ?? (await getChild(input.child_id))?.grade ?? '';
  const rec: GrowthRecord = {
    id: db.uid('gr'),
    child_id: input.child_id,
    type: input.type,
    title: input.title,
    description: input.description,
    record_date: input.record_date,
    knowledge_id: input.knowledge_id ?? null,
    is_backfill: input.is_backfill ?? false,
    grade,
    metadata: input.metadata ?? null,
    created_at: new Date().toISOString(),
    sync_state: 'pending',
  };
  await db.put('growth_records', rec);
  return rec;
}

export async function getGrowthRecords(childId: string): Promise<GrowthRecord[]> {
  const all = await db.getAll('growth_records');
  return all.filter((g) => g.child_id === childId).sort((a, b) => b.record_date.localeCompare(a.record_date));
}

// ------------------------------------------------------------------ 录音

export async function createAudioRecord(input: {
  child_id: string;
  knowledge_id: string | null;
  storage_path: string;
  duration: number;
}) {
  const rec = {
    id: db.uid('au'),
    ...input,
    created_at: new Date().toISOString(),
    sync_state: 'pending' as SyncState,
  };
  await db.put('audio_records', rec);
  // 录音是成长记录，沉淀到时间轴（V1.1 Change 07）
  const kn = input.knowledge_id ? contentService.getKnowledgeById(input.knowledge_id) : null;
  await createGrowthRecord({
    child_id: input.child_id,
    type: 'audio',
    title: kn ? `一段关于「${kn.title}」的讲解` : '一段成长录音',
    description: `🎙️ ${Math.round(input.duration)} 秒${kn ? ` · ${kn.subject}` : ''}`,
    record_date: todayISO(),
    knowledge_id: input.knowledge_id,
    metadata: { audio_id: rec.id, duration: input.duration },
  });
  return rec;
}

export async function getAudioRecords(childId: string, knowledgeId?: string) {
  const all = await db.getAll('audio_records');
  return all
    .filter((a) => a.child_id === childId && (!knowledgeId || a.knowledge_id === knowledgeId))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 供 syncService 拉取待同步数据 */
export async function getAllPending() {
  const [children, reviews, items, checkins, assessments, records, audio] = await Promise.all([
    db.getAll('children'),
    db.getAll('weekly_reviews'),
    db.getAll('review_items'),
    db.getAll('progress_checkins'),
    db.getAll('assessments'),
    db.getAll('growth_records'),
    db.getAll('audio_records'),
  ]);
  const pend = <T extends { sync_state: SyncState }>(rows: T[]) => rows.filter((r) => r.sync_state !== 'synced');
  return {
    children: pend(children),
    weekly_reviews: pend(reviews),
    review_items: pend(items),
    progress_checkins: pend(checkins),
    assessments: pend(assessments),
    growth_records: pend(records),
    audio_records: pend(audio),
  };
}

/**
 * 推送成功后把对应行标记为 synced（outbox 出队）。
 * 入参为 getAllPending() 返回的分组；逐表更新，避免影响本次之外的新写入。
 */
export async function markAllSynced(groups: Awaited<ReturnType<typeof getAllPending>>): Promise<void> {
  const stamp = <R extends { sync_state: SyncState }>(r: R): R => ({
    ...r,
    sync_state: 'synced' as SyncState,
  });
  await Promise.all([
    db.putMany('children', groups.children.map(stamp)),
    db.putMany('weekly_reviews', groups.weekly_reviews.map(stamp)),
    db.putMany('review_items', groups.review_items.map(stamp)),
    db.putMany('progress_checkins', groups.progress_checkins.map(stamp)),
    db.putMany('assessments', groups.assessments.map(stamp)),
    db.putMany('growth_records', groups.growth_records.map(stamp)),
    db.putMany('audio_records', groups.audio_records.map(stamp)),
  ]);
  invalidate();
}

/**
 * 反向拉取（新设备恢复）：把云端数据写回 IndexedDB。
 * 云端行直接覆盖本地（同样的 id），并标记为 synced。
 */
export async function upsertFromRemote(rows: Awaited<ReturnType<typeof getAllPending>>): Promise<void> {
  const asSynced = <R extends { sync_state: SyncState }>(r: R): R => ({
    ...r,
    sync_state: 'synced' as SyncState,
  });
  await Promise.all([
    db.putMany('children', rows.children.map(asSynced)),
    db.putMany('weekly_reviews', rows.weekly_reviews.map(asSynced)),
    db.putMany('review_items', rows.review_items.map(asSynced)),
    db.putMany('progress_checkins', rows.progress_checkins.map(asSynced)),
    db.putMany('assessments', rows.assessments.map(asSynced)),
    db.putMany('growth_records', rows.growth_records.map(asSynced)),
    db.putMany('audio_records', rows.audio_records.map(asSynced)),
  ]);
  invalidate();
}
