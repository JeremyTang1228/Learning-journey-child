/**
 * 应用外壳：路由 + 底部导航 + 数据恢复态。
 * 信息架构来自 Overview.html：4 个固定 Tab + 设置页。
 */
import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import BottomNav from '@/components/BottomNav';
import GrowthMapHome from '@/pages/GrowthMapHome';
import WeeklyReview from '@/pages/WeeklyReview';
import ParentDashboard from '@/pages/ParentDashboard';
import GrowthTimeline from '@/pages/GrowthTimeline';
import Settings from '@/pages/Settings';
import { useAppStore } from '@/store/appStore';
import { contentService } from '@/services/contentService';
import PWAInstallPrompt from '@/components/PWAInstallPrompt';

export default function App() {
  const init = useAppStore((s) => s.init);
  const ready = useAppStore((s) => s.ready);
  const restoring = useAppStore((s) => s.restoring);
  const hasChild = useAppStore((s) => s.children.length > 0);
  const location = useLocation();

  useEffect(() => {
    void init();
  }, [init]);

  // 预取当前年级内容，让地图首屏更快
  useEffect(() => {
    const grade = useAppStore.getState().currentChild?.grade;
    if (grade && !contentService.isGradeLoaded(grade)) void contentService.loadGrade(grade);
  }, [ready]);

  // 还没有孩子时，先引导到设置页（第 66 节空状态：不能白屏）
  if (ready && !hasChild && location.pathname !== '/settings') {
    return <Navigate to="/settings" replace />;
  }

  return (
    <>
      {restoring ? (
        <div className="page center" style={{ paddingTop: '32vh' }}>
          <div style={{ fontSize: 40, animation: 'bob 1.6s var(--ease) infinite' }}>🗺️</div>
          <div className="t-sub" style={{ marginTop: 12 }}>
            欢迎回来，正在恢复成长地图……
          </div>
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<GrowthMapHome />} />
          <Route path="/review" element={<WeeklyReview />} />
          <Route path="/dashboard" element={<ParentDashboard />} />
          <Route path="/timeline" element={<GrowthTimeline />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
      <BottomNav />
      <PWAInstallPrompt />
    </>
  );
}
