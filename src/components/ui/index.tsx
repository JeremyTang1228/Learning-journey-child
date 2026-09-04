/**
 * 基础 UI 组件。
 * 视觉规范严格对齐 03_UI_Prototype/DesignSystem.html：
 *   - 全线大圆角，无直角
 *   - 实心硬阴影，按下时阴影消失 + 下移
 *   - 五态状态色语义唯一，不挪用
 *   - 每页四态齐全：正常 / 空 / 加载 / 异常
 */
import { useEffect, type ReactNode } from 'react';
import { STATUS } from '@/utils/status';
import type { KnowledgeStatus } from '@/types/user';

// ---------------------------------------------------------------- 状态点

export function StatusDot({ status, size = 'md' }: { status: KnowledgeStatus; size?: 'sm' | 'md' | 'lg' }) {
  const s = STATUS[status];
  return (
    <span
      className={`dot${size === 'sm' ? ' sm' : size === 'lg' ? ' lg' : ''}`}
      style={{ background: s.color }}
      aria-label={s.label}
      title={s.label}
    />
  );
}

export function StatusBadge({ status }: { status: KnowledgeStatus }) {
  const s = STATUS[status];
  return (
    <span className="badge">
      <StatusDot status={status} size="sm" />
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------- 进度

export function Bar({ pct, color = 'var(--green)' }: { pct: number; color?: string }) {
  return (
    <div className="bar">
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

export function Ring({ pct, size = 96, color = 'var(--green)', label }: { pct: number; size?: number; color?: string; label?: string }) {
  const r = size / 2 - 8;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(59,46,34,0.12)" strokeWidth="9" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 700ms var(--ease)' }}
      />
      <text
        x="50%"
        y={label ? '44%' : '50%'}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ fontFamily: 'var(--font-title)', fontSize: size * 0.26, fill: 'var(--ink)' }}
      >
        {Math.round(v)}%
      </text>
      {label ? (
        <text
          x="50%"
          y="70%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: size * 0.12, fill: 'var(--ink-soft)' }}
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}

// ---------------------------------------------------------------- 空 / 加载 / 异常

export function EmptyState({
  icon = '🧭',
  title,
  desc,
  action,
}: {
  icon?: string;
  title: string;
  desc?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="t-sub">{title}</div>
      {desc ? <div className="t-meta" style={{ lineHeight: 1.6 }}>{desc}</div> : null}
      {action ? <div style={{ marginTop: 8 }}>{action}</div> : null}
    </div>
  );
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack-sm">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skel" style={{ height: i === 0 ? 88 : 56 }} />
      ))}
    </div>
  );
}

export function ErrorState({ desc = '网络好像不太稳定，检查一下再试试看', onRetry }: { desc?: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="🧭"
      title="这张成长卡走丢了"
      desc={desc}
      action={
        onRetry ? (
          <button className="btn" onClick={onRetry}>
            重新加载
          </button>
        ) : null
      }
    />
  );
}

// ---------------------------------------------------------------- Bottom Sheet

export function Sheet({
  open,
  onClose,
  children,
  dismissable = true,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  dismissable?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="sheet-mask"
      onClick={() => dismissable && onClose()}
      role="presentation"
    >
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 同步状态

export function SyncBadge({ state }: { state: 'local' | 'syncing' | 'synced' | 'failed' }) {
  const map = {
    local: { icon: '📱', text: '已保存到本机' },
    syncing: { icon: '🔄', text: '正在同步' },
    synced: { icon: '☁️', text: '已同步' },
    failed: { icon: '⏳', text: '暂时无法同步' },
  } as const;
  const m = map[state];
  return (
    <span className={`syncbar${state === 'syncing' ? ' syncing' : ''}`}>
      <span>{m.icon}</span>
      {m.text}
    </span>
  );
}

// ---------------------------------------------------------------- Toast

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function showToast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  if (toastTimer) clearTimeout(toastTimer);
  const prev = document.querySelectorAll('.toast');
  prev.forEach((p, i) => {
    if (i < prev.length - 1) p.remove();
  });
  toastTimer = setTimeout(() => el.remove(), 2200);
}
