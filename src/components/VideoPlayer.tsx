import { useEffect, useRef, useState } from 'react';
import type { Resource } from '@/types/content';
import {
  fetchPlayInfo,
  loadTcplayer,
  parsePlayUrl,
  sourcePageUrl,
} from '@/lib/player';
import styles from './video.module.css';

function fmtDur(s: number): string {
  if (!s || s <= 0) return '';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function VideoPlayer({ r }: { r: Resource }) {
  const [open, setOpen] = useState(false);
  const playable = r.is_playable && !!r.play_url;
  const dur = fmtDur(r.duration_sec);

  const thumb = (
    <div
      className={styles.thumb}
      style={r.cover_url ? { backgroundImage: `url("${r.cover_url}")` } : undefined}
    >
      {!r.cover_url && <span className={styles.thumbIcon}>🎬</span>}
      <span className={styles.play} aria-hidden>
        ▶
      </span>
      {dur && <span className={styles.dur}>{dur}</span>}
      {playable && <span className={styles.ext}>App 内播放</span>}
    </div>
  );
  const info = (
    <div className={styles.info}>
      <div className={styles.title}>{r.title}</div>
      <div className={styles.metaRow}>
        {r.source_module && <span className={styles.tag}>{r.source_module}</span>}
        {playable ? (
          <span className={styles.canPlay}>▶ 可播放</span>
        ) : (
          <span className={styles.need}>来源平台观看</span>
        )}
      </div>
    </div>
  );

  if (!playable || !r.play_url) {
    return (
      <div className={`${styles.card} ${styles.disabled}`} title={r.title}>
        {thumb}
        {info}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className={styles.card}
        onClick={() => setOpen(true)}
        title={`在 App 内播放「${r.title}」`}
      >
        {thumb}
        {info}
      </button>

      {open && <PlayerModal r={r} onClose={() => setOpen(false)} />}
    </>
  );
}

type Status = 'loading' | 'ready' | 'error';

function PlayerModal({ r, onClose }: { r: Resource; onClose: () => void }) {
  const [status, setStatus] = useState<Status>('loading');
  const [errMsg, setErrMsg] = useState('');
  const parsed = parsePlayUrl(r.play_url);
  const playerRef = useRef<unknown>(null);

  useEffect(() => {
    let disposed = false;
    let container: HTMLVideoElement | null = null;

    (async () => {
      try {
        if (!parsed) throw new Error('无效的播放地址');
        const info = await fetchPlayInfo(parsed.module, parsed.resourceId);
        if (disposed) return;
        await loadTcplayer();
        if (disposed) return;
        const TCPlayer = (window as unknown as { TCPlayer: new (
          id: string,
          opts: Record<string, unknown>,
        ) => unknown }).TCPlayer;
        container = document.getElementById(
          'tcplayer-container',
        ) as HTMLVideoElement | null;
        if (!container) throw new Error('播放器容器未就绪');
        playerRef.current = new TCPlayer('tcplayer-container', {
          fileID: info.fileId,
          appID: info.appId,
          psign: info.psign,
          autoplay: true,
        });
        setStatus('ready');
      } catch (e) {
        if (!disposed) {
          setStatus('error');
          setErrMsg(e instanceof Error ? e.message : '播放失败');
        }
      }
    })();

    return () => {
      disposed = true;
      try {
        const p = playerRef.current as { dispose?: () => void } | null;
        p?.dispose?.();
      } catch {
        /* noop */
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.frameMask} onClick={onClose}>
      <div className={styles.frameWrap} onClick={(e) => e.stopPropagation()}>
        <div className={styles.frameBar}>
          <span className={styles.frameTitle}>{r.title}</span>
          <button
            type="button"
            className={styles.frameClose}
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        <div className={styles.playerArea}>
          {status === 'loading' && (
            <div className={styles.loading}>正在加载播放器…</div>
          )}
          {status === 'error' && (
            <div className={styles.error}>
              <p className={styles.errTitle}>视频加载失败：{errMsg}</p>
              <p className={styles.errHint}>
                可能原因：当前网络无法访问江苏教育平台。你也可以在新窗口打开来源平台观看。
              </p>
              {parsed && (
                <a
                  className={styles.extLink}
                  href={sourcePageUrl(parsed.module, parsed.resourceId)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  在来源平台观看
                </a>
              )}
            </div>
          )}
          <video
            id="tcplayer-container"
            className={styles.frame}
            preload="auto"
            playsInline
            webkit-playsinline
          />
        </div>
      </div>
    </div>
  );
}
