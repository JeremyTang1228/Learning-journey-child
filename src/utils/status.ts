/**
 * 五态知识状态。
 *
 * 颜色与语义严格一一对应，禁止挪作他用，禁止用状态色表达学科身份。
 * ⚪ 未复核 ≠ 不会 —— UI 中永远只表达「还没复核」，
 * 严禁渲染成「不合格/待处理」，严禁使用红色系。
 *
 * 标签取值说明：DesignSystem.html 与 KnowledgeCard.html 均为「需要加强」，
 * ResourceSupport.html 为「建议加强」。此处以 Design System 为准取「需要加强」。
 */
import type { ChildRating, KnowledgeStatus, ParentRating } from '@/types/user';

export interface StatusDef {
  key: KnowledgeStatus;
  /** 圆点 emoji 仅用于文案，实际渲染用 CSS 颜色 */
  dot: string;
  label: string;
  color: string;
  /** 语义说明，未复核刻意保持中性 */
  hint: string;
}

export const STATUS: Record<KnowledgeStatus, StatusDef> = {
  unreviewed: { key: 'unreviewed', dot: '⚪', label: '未复核', color: 'var(--gray)', hint: '还不知道呢' },
  basic: { key: 'basic', dot: '🟡', label: '基本掌握', color: 'var(--yellow)', hint: '大体上会了' },
  mastered: { key: 'mastered', dot: '🟢', label: '已掌握', color: 'var(--green)', hint: '很稳了' },
  needs_review: { key: 'needs_review', dot: '🟠', label: '需要加强', color: 'var(--orange)', hint: '再练练' },
  focus: { key: 'focus', dot: '🔴', label: '重点关注', color: 'var(--red)', hint: '需要一起加把劲' },
};

/** 展示顺序：需要关注的在前 */
export const STATUS_ORDER: KnowledgeStatus[] = ['focus', 'needs_review', 'basic', 'mastered', 'unreviewed'];

export const CHILD_RATINGS: { key: ChildRating; emoji: string; label: string }[] = [
  { key: 'bad2', emoji: '😵', label: '不会' },
  { key: 'bad1', emoji: '😕', label: '不太会' },
  { key: 'good1', emoji: '🙂', label: '基本会' },
  { key: 'good2', emoji: '😄', label: '很会' },
];

export const PARENT_RATINGS: { key: ParentRating; status: KnowledgeStatus; dot: string; label: string; color: string }[] = [
  { key: 'mastered', status: 'mastered', dot: '🟢', label: '已掌握', color: 'var(--green)' },
  { key: 'basic', status: 'basic', dot: '🟡', label: '基本掌握', color: 'var(--yellow)' },
  { key: 'needs_review', status: 'needs_review', dot: '🟠', label: '需要加强', color: 'var(--orange)' },
  { key: 'focus', status: 'focus', dot: '🔴', label: '重点关注', color: 'var(--red)' },
];

export const childRatingOf = (k: ChildRating | null) => CHILD_RATINGS.find((r) => r.key === k) || null;
export const parentRatingOf = (k: ParentRating | null) => PARENT_RATINGS.find((r) => r.key === k) || null;

/** 是否属于「需要关注」（🟠/🔴）。⚪ 未复核不计入 —— 它不代表掌握不佳。 */
export const needsAttention = (s: KnowledgeStatus) => s === 'needs_review' || s === 'focus';

/** 「已掌握 / 基本掌握」合计，用于完成页统计 */
export const isStable = (s: KnowledgeStatus) => s === 'mastered' || s === 'basic';

export const GRADE_ORDER = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'] as const;

export const gradeIndex = (g: string) => {
  const i = GRADE_ORDER.indexOf(g as (typeof GRADE_ORDER)[number]);
  return i < 0 ? 0 : i;
};

/**
 * Unit 地标图标。
 * Master Data 的 map_icon 全为空，此处按单元序号确定性地映射地标图形，
 * 仅为呈现层视觉，不改变内容语义；Excel 一旦填写 map_icon 即以其为准。
 */
const LANDMARKS = ['🏘️', '🏰', '🌲', '⛰️', '🏝️', '🌉', '⛲', '🎪', '🏕️', '🗼'];
export const landmarkIcon = (idx: number) => LANDMARKS[idx % LANDMARKS.length];

/** 资源类型 → 展示信息。is_playable=false 时 UI 必须降级，不得假装可播放。 */
export const RESOURCE_META: Record<string, { label: string; icon: string }> = {
  video: { label: '视频', icon: '🎥' },
  ppt: { label: '课件', icon: '📊' },
  ppt_preview: { label: '课件预览', icon: '📊' },
  homework: { label: '作业', icon: '📝' },
  task_sheet: { label: '学习单', icon: '📄' },
  lesson_plan: { label: '教案', icon: '📚' },
  other: { label: '资料', icon: '📎' },
};
export const resourceMeta = (t: string) => RESOURCE_META[t] || { label: '资料', icon: '📄' };
