/**
 * User Data 类型定义
 * 对应开发总 Prompt 第 214-228 节的"第二层：User Data"。
 * 关键约束：
 *   - 用户数据只存 Stable ID（knowledge_id / unit_id），禁止存名称
 *   - review_items 永远追加，不覆盖、不删除（V1.1 校准报告 Handoff Notes）
 *   - 录音不存 Blob，只存路径
 */

/** 五态知识状态。⚪ 未复核 ≠ 不会，UI 严禁渲染为负面语义 */
export type KnowledgeStatus = 'unreviewed' | 'mastered' | 'basic' | 'needs_review' | 'focus';

/** 家长判断 → 知识状态，一一对应 */
export type ParentRating = 'mastered' | 'basic' | 'needs_review' | 'focus';

/** 孩子自评四档，一键完成，不要求文字输入 */
export type ChildRating = 'bad2' | 'bad1' | 'good1' | 'good2';

export type SyncState = 'pending' | 'syncing' | 'synced' | 'failed';

export type ReviewStatus = 'in_progress' | 'completed' | 'skipped';

export interface Child {
  id: string;
  parent_id: string;
  name: string;
  avatar: string;
  grade: string;
  /** 入学年份，用于"在小学路上走了 N 天" */
  school_year: string;
  created_at: string;
  updated_at: string;
  sync_state: SyncState;
}

export interface WeeklyReview {
  id: string;
  child_id: string;
  /** ISO 周一，如 2026-08-31 */
  week_start: string;
  week_end: string;
  week_no: number;
  /** 复盘所记录的真实日期（支持补录过去） */
  review_date: string;
  status: ReviewStatus;
  /** 是否为事后补录（时间轴需显示"补录于 X"角标） */
  is_backfill: boolean;
  note: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  sync_state: SyncState;
}

export interface ReviewItem {
  id: string;
  review_id: string;
  child_id: string;
  /** Stable ID，来自 Master Data，永不因改名/改排序而变化 */
  knowledge_id: string;
  child_rating: ChildRating | null;
  parent_rating: ParentRating | null;
  knowledge_status: KnowledgeStatus;
  note: string;
  /** 该知识点被复核的次数（累计，用于"第 N 次复核仍需加强"） */
  review_count: number;
  /** 下次建议复核日期 */
  next_review_date: string | null;
  content_version: string;
  created_at: string;
  updated_at: string;
  sync_state: SyncState;
}

/** V1.1 新增：实际学习进度确认（地图位置只由显式确认驱动） */
export interface ProgressCheckIn {
  id: string;
  child_id: string;
  week_start: string;
  subject_id: string;
  /** 学校实际学到的单元（Stable ID） */
  actual_unit_id: string | null;
  /** on_pace | ahead | behind | no_class */
  delta_type: 'on_pace' | 'ahead' | 'behind' | 'no_class' | null;
  confirmed_at: string;
  sync_state: SyncState;
}

export interface Assessment {
  id: string;
  child_id: string;
  subject_id: string;
  exam_type: string;
  exam_date: string;
  score: number;
  full_score: number;
  semester: string;
  note: string;
  created_at: string;
  updated_at: string;
  sync_state: SyncState;
}

/** 时间轴事件类型，skip 为 V1.1 新增（校准报告 07） */
export type GrowthRecordType =
  | 'map_progress'
  | 'knowledge'
  | 'weekly_review'
  | 'assessment'
  | 'audio'
  | 'note'
  | 'milestone'
  | 'skip';

export interface GrowthRecord {
  id: string;
  child_id: string;
  type: GrowthRecordType;
  title: string;
  description: string;
  record_date: string;
  knowledge_id: string | null;
  is_backfill: boolean;
  /** 记录产生时孩子所在的年级，用于时间轴按"小学六年"分年（V1.1 Change 07） */
  grade?: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  sync_state: SyncState;
}

export interface AudioRecord {
  id: string;
  child_id: string;
  knowledge_id: string | null;
  storage_path: string;
  duration: number;
  created_at: string;
  sync_state: SyncState;
}
