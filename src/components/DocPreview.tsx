import { useEffect, useRef, useState } from 'react';
import type { Resource } from '@/types/content';
import { docPreviewInfo, pageImageUrl, probeTotalPages } from '@/lib/docPreview';
import styles from './docPreview.module.css';

const ICONS: Record<string, string> = {
  pptx: '📊',
  ppt: '📊',
  docx: '📝',
  doc: '📝',
  pdf: '📕',
  xlsx: '📈',
  xls: '📈',
};

/** 资源卡片：可预览文档 → 点击打开 App 内预览；不可预览 → 保留「跳原链接」行为。 */
export function DocPreviewCard({ r }: { r: Resource }) {
  const info = docPreviewInfo(r.url);
  const href = r.url && /^https?:\/\//i.test(r.url) ? r.url : undefined;

  if (!info) {
    return (
      <a className="card row" href={href} target="_blank" rel="noreferrer">
        <span style={{ fontSize: 20 }}>📄</span>
        <span className="grow">
          <span className="t-body" style={{ fontSize: 13 }}>{r.title}</span>
          <span className="t-meta" style={{ display: 'block' }}>{r.source_platform}</span>
        </span>
        <span className="t-mute">›</span>
      </a>
    );
  }

  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="card row" onClick={() => setOpen(true)}>
        <span style={{ fontSize: 20 }}>{ICONS[info.srcType] || '📄'}</span>
        <span className="grow">
          <span className="t-body" style={{ fontSize: 13 }}>{r.title}</span>
          <span className="t-meta" style={{ display: 'block' }}>
            {r.source_platform} · <span className={styles.canPreview}>App 内预览</span>
          </span>
        </span>
        <span className="t-mute">›</span>
      </button>
      {open && (
        <DocPreviewModal
          r={r}
          base={info.base}
          srcType={info.srcType}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const DEFAULT_RATIOS: Record<string, number> = {
  pptx: 16 / 9,
  ppt: 4 / 3,
  docx: 210 / 297,
  doc: 210 / 297,
  pdf: 210 / 297,
  xlsx: 4 / 3,
  xls: 4 / 3,
};

type ViewStatus = 'probing' | 'ready' | 'error';

/** 单页 JPEG 预览浮层。
 *  之前用 background-image + padding-bottom hack 维持比例，在 WebKit/Blink 下出现横向条纹/扫描线错乱，
 *  根因是 CSS calc 对 var() fallback 中含斜杠的表达式解析异常（16 / 9 被拆成多次除法），导致容器高度塌缩。
 *  现改用 <img> 直显 + aspect-ratio 属性，比例由 JS 根据图片 natural 尺寸设置纯数字 CSS 变量，稳定可靠。 */
function DocPreviewModal({
  r,
  base,
  srcType,
  onClose,
}: {
  r: Resource;
  base: string;
  srcType: string;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<ViewStatus>('probing');
  const [total, setTotal] = useState(1);
  const [page, setPage] = useState(1);
  const [ratio, setRatio] = useState<number>(DEFAULT_RATIOS[srcType] || 16 / 9);
  const [imgStatus, setImgStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 探测总页数
  useEffect(() => {
    let mounted = true;
    probeTotalPages(base, srcType).then((n) => {
      if (!mounted) return;
      if (n <= 0) {
        setStatus('error');
      } else {
        setTotal(n);
        setStatus('ready');
      }
    });
    return () => {
      mounted = false;
    };
  }, [base, srcType]);

  // 切页时自动滚动到顶部并重置加载态
  useEffect(() => {
    setImgStatus('loading');
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [page]);

  // 键盘快捷键：Esc 关闭，左右箭头翻页
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1));
      if (e.key === 'ArrowRight') setPage((p) => Math.min(total, p + 1));
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [total, onClose]);

  const url = pageImageUrl(base, srcType, page);
  const canPrev = page > 1;
  const canNext = page < total;

  return (
    <div className={styles.frameMask} onClick={onClose}>
      <div className={styles.frameWrap} onClick={(e) => e.stopPropagation()}>
        <div className={styles.frameBar}>
          <span className={styles.frameTitle}>{r.title}</span>
          <div className={styles.barActions}>
            <a
              className={styles.dlBtn}
              href={base}
              target="_blank"
              rel="noreferrer"
              title="下载原文件"
            >
              下载
            </a>
            <button className={styles.frameClose} onClick={onClose} aria-label="关闭">
              ✕
            </button>
          </div>
        </div>

        <div className={styles.viewerWrap}>
          {status === 'probing' && (
            <div className={styles.center}>
              <div className={styles.spinner} />
              <div>正在准备预览…</div>
            </div>
          )}
          {status === 'error' && (
            <div className={styles.center}>
              <p className={styles.errTitle}>文档预览失败</p>
              <p className={styles.hint}>可能当前网络无法访问江苏教育云平台资源，或该文档页数为 0。</p>
              <a className={styles.extLink} href={base} target="_blank" rel="noreferrer">
                改为下载原文件
              </a>
            </div>
          )}
          {status === 'ready' && (
            <>
              <div className={styles.scroll} ref={scrollRef}>
                <div
                  className={styles.page}
                  style={{ '--page-ratio': String(ratio) } as React.CSSProperties}
                >
                  {imgStatus === 'loading' && (
                    <div className={styles.pageSkeleton}>
                      <div className={styles.spinner} />
                      <div>正在加载第 {page} 页…</div>
                    </div>
                  )}
                  <img
                    className={styles.pageImg}
                    src={url}
                    alt={`${r.title} 第${page}页`}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      if (img.naturalHeight > 0) {
                        setRatio(img.naturalWidth / img.naturalHeight);
                      }
                      setImgStatus('loaded');
                    }}
                    onError={() => setImgStatus('error')}
                    style={{ opacity: imgStatus === 'loaded' ? 1 : 0 }}
                  />
                  {imgStatus === 'error' && (
                    <div className={styles.pageErr}>
                      <p className={styles.errTitle}>第 {page} 页加载失败</p>
                      <button
                        type="button"
                        className={styles.retryBtn}
                        onClick={() => setPage((p) => p)}
                      >
                        重试
                      </button>
                      <a className={styles.extLink} href={base} target="_blank" rel="noreferrer">
                        下载原文件
                      </a>
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.pageNav}>
                <button
                  type="button"
                  className={styles.navBtn}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={!canPrev}
                  aria-label="上一页"
                >
                  ‹
                </button>
                <span className={styles.pageNo}>
                  {page} / {total}
                </span>
                <button
                  type="button"
                  className={styles.navBtn}
                  onClick={() => setPage((p) => Math.min(total, p + 1))}
                  disabled={!canNext}
                  aria-label="下一页"
                >
                  ›
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
