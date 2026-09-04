import { contentService } from '@/services/contentService';
import type { Subject } from '@/types/content';

interface SubjectTagProps {
  /** 学科稳定 ID（subj_xxx），优先用它对 subjects.json 取色与图标 */
  subjectId?: string;
  /** 已拿到 Subject 对象时直接传，省一次查找 */
  subject?: Subject;
  /** 显示名覆盖：默认用 map_name（如「汉字森林」），也可用 subject（「小学语文」） */
  label?: string;
  /** 尺寸 */
  size?: 'sm' | 'md' | 'lg';
}

/** 把 #RRGGBB 转 rgba，用于淡底 */
function hexToRgba(hex: string, a: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return `rgba(59,46,34,${a})`;
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 学科标签：用 subjects.json 的 color + map_icon 渲染一枚带色的 pill。
 * 在周复盘、家长看板的「需要关注」「知识点详情」等处复用，统一区分语数英。
 */
export function SubjectTag({ subjectId, subject, label, size = 'md' }: SubjectTagProps) {
  const s = subject ?? (subjectId ? contentService.getSubject(subjectId) : undefined);
  if (!s) return null;
  const color = s.color;
  const name = label ?? s.map_name ?? s.display_name ?? s.subject;
  const icon = s.map_icon;
  return (
    <span
      className="subject-tag"
      data-size={size}
      style={{
        color,
        borderColor: color,
        background: hexToRgba(color, 0.12),
      }}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      {name}
    </span>
  );
}
