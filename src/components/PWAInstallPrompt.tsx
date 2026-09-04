/**
 * PWA 安装引导：首次打开网页时弹出「安装到主屏幕」说明。
 * - 支持浏览器原生安装（Android Chrome / 桌面 Edge / 桌面 Chrome）：捕获 beforeinstallprompt，点按钮触发。
 * - iOS Safari 无原生安装 API：给出「分享 → 添加到主屏幕」分步指引。
 * - 用 localStorage 控制只提示一次；已安装（standalone）则不提示。
 */
import { useCallback, useEffect, useState } from 'react';
import styles from './pwaInstall.module.css';

const SEEN_KEY = 'growthmap_pwa_install_seen_v1';

/** beforeinstallprompt 事件的非标准形状 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua);
  // iPadOS 13+ 伪装成 Mac，但带触屏
  const macTouch = /Macintosh/.test(ua) && 'ontouchend' in document;
  return ios || macTouch;
}

function isStandalone(): boolean {
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone || iosStandalone;
}

export default function PWAInstallPrompt() {
  const [open, setOpen] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios] = useState<boolean>(isIos());

  // 捕获浏览器原生安装事件（Android/桌面 Chrome/Edge）
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt as EventListener);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt as EventListener);
  }, []);

  // 首次打开、未安装、未提示过 → 延迟弹出
  useEffect(() => {
    if (isStandalone()) return;
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      seen = false;
    }
    if (seen) return;
    const t = window.setTimeout(() => setOpen(true), 1500);
    return () => window.clearTimeout(t);
  }, []);

  // 安装完成后关闭并标记
  useEffect(() => {
    const onInstalled = () => {
      try {
        localStorage.setItem(SEEN_KEY, '1');
      } catch {
        /* ignore */
      }
      setOpen(false);
      setDeferred(null);
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, []);

  const markSeen = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
  }, []);

  const dismiss = useCallback(() => {
    markSeen();
    setOpen(false);
  }, [markSeen]);

  const install = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    setOpen(false);
    if (outcome === 'accepted') markSeen();
  }, [deferred, markSeen]);

  if (!open) return null;

  return (
    <div className="sheet-mask" onClick={dismiss}>
      <div
        className="sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="安装到主屏幕"
      >
        <div className="sheet-grip" />
        <div className={styles.icon}>🗺️</div>
        <h2 className="t-title" style={{ textAlign: 'center', marginTop: 6 }}>
          安装「成长地图」到主屏幕
        </h2>
        <p className={styles.desc}>
          添加到主屏幕后，它就像手机里的原生 App：一键直达、离线也能打开，孩子和家长的成长记录随时可见。
        </p>

        {ios && (
          <div className={styles.steps}>
            <p>
              ① 点击 Safari 底部工具栏的 <b>分享</b> 按钮 ↗
            </p>
            <p>
              ② 向上滑动，找到并点「<b>添加到主屏幕</b>」
            </p>
            <p>③ 点「添加」，完成 ✅</p>
          </div>
        )}

        <div className="stack-sm" style={{ marginTop: 16 }}>
          {!ios && deferred && (
            <button className="btn btn-primary btn-block btn-lg" onClick={install}>
              立即安装
            </button>
          )}
          {!ios && !deferred && (
            <p className={styles.note}>
              若没看到安装按钮，可点浏览器右上角菜单中的「安装应用 / 添加到主屏幕」。
            </p>
          )}
          <button className="btn btn-ghost btn-block" onClick={dismiss}>
            {ios ? '我知道了' : '稍后再说'}
          </button>
        </div>
      </div>
    </div>
  );
}
