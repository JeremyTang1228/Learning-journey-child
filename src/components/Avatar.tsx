/**
 * Avatar —— 统一的「孩子头像」渲染组件。
 *
 * 头像字段（Child.avatar）有两种取值：
 *   1) emoji 字符串（如 '🧒'）—— 默认 / 用户选择的表情；
 *   2) data:image/... 的 data URL —— 用户上传并自动压缩后的小朋友照片。
 *
 * 组件按取值自动判断：是图片就渲染圆形成 cover 裁剪的 <img>，否则渲染 emoji 文字。
 * 这样全 App 所有出现头像的地方（设置卡、切换孩子、家长看板、成长地图）表现一致。
 */
import type { CSSProperties } from 'react';

const EMOJI_FALLBACK = '🧒';

/** 判断 avatar 字段是否为用户上传的图片（data URL） */
export function isImageAvatar(value?: string | null): boolean {
  return !!value && value.startsWith('data:image');
}

interface AvatarProps {
  value?: string | null;
  /** 圆形直径（px），默认 52，与设置卡一致 */
  size?: number;
  /** 额外样式（如成长地图上的 top/left 定位） */
  style?: CSSProperties;
  className?: string;
}

export default function Avatar({ value, size = 52, style, className }: AvatarProps) {
  const img = isImageAvatar(value);
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flex: 'none',
    overflow: 'hidden',
    display: 'grid',
    placeItems: 'center',
    border: 'var(--border)',
    boxShadow: 'var(--shadow-sm)',
    background: img ? '#fff' : 'radial-gradient(circle at 32% 28%, #f8e6b8, #e3b96b)',
    fontSize: Math.round(size * 0.55),
    lineHeight: 1,
    userSelect: 'none',
    ...style,
  };

  if (img) {
    return (
      <span className={className} style={base} role="img" aria-label="孩子头像">
        <img
          src={value as string}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }

  return (
    <span className={className} style={base} role="img" aria-label="孩子头像">
      {value || EMOJI_FALLBACK}
    </span>
  );
}
