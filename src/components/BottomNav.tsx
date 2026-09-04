/**
 * 底部导航 —— 信息架构里唯一的四个固定入口。
 * 来源：Overview.html「四个 tab 之间可以随便逛，不会丢失彼此的状态」
 */
import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/', icon: '🗺️', label: '成长地图', end: true },
  { to: '/review', icon: '📋', label: '本周复盘', end: false },
  { to: '/dashboard', icon: '📊', label: '家长看板', end: false },
  { to: '/timeline', icon: '🌱', label: '成长档案', end: false },
];

export default function BottomNav() {
  return (
    <nav className="bottomnav" aria-label="主导航">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.end}>
          {({ isActive }) => (
            <button type="button" className={isActive ? 'on' : ''} aria-current={isActive ? 'page' : undefined}>
              <span className="ico">{t.icon}</span>
              <span>{t.label}</span>
            </button>
          )}
        </NavLink>
      ))}
    </nav>
  );
}
