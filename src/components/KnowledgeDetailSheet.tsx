import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentService } from '@/services/contentService';
import * as userData from '@/services/userDataService';
import { STATUS } from '@/utils/status';
import type { KnowledgeStatus } from '@/types/user';
import { EmptyState, StatusBadge } from '@/components/ui';
import { SubjectTag } from '@/components/SubjectTag';
import { VideoPlayer } from '@/components/VideoPlayer';
import { DocPreviewCard } from '@/components/DocPreview';
import styles from './knowledgeDetail.module.css';

export function KnowledgeDetailSheet({ childId, knowledgeId }: { childId: string; knowledgeId: string }) {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<{ status: KnowledgeStatus; count: number; last: string } | null>(null);
  const [history, setHistory] = useState<{ status: KnowledgeStatus; date: string; review: number }[]>([]);
  const kn = contentService.getKnowledgeById(knowledgeId);
  const resources = kn ? dedupeByUrl(contentService.getResources(kn.knowledge_id, 3)) : [];

  useEffect(() => {
    void (async () => {
      const snaps = await userData.getKnowledgeSnapshots(childId, [knowledgeId]);
      const s = snaps.get(knowledgeId);
      if (s) setSnap({ status: s.status, count: s.review_count, last: s.last_reviewed_at });
      const h = await userData.getKnowledgeHistory(childId, knowledgeId);
      setHistory(h.map((i) => ({ status: i.knowledge_status, date: i.created_at, review: i.review_count })));
    })();
  }, [childId, knowledgeId]);

  if (!kn) return <EmptyState icon="🧭" title="找不到这个知识点" desc="可能内容已经更新了" />;

  return (
    <div className="stack">
      <div>
        <div className="t-meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SubjectTag subjectId={kn.subject_id} /> · {kn.unit_name}
        </div>
        <div className="t-title" style={{ margin: '4px 0 8px' }}>{kn.title}</div>
        {snap ? (
          <div className="row wrap" style={{ gap: 6 }}>
            <StatusBadge status={snap.status} />
            {snap.count > 0 ? <span className="chip mute">第 {snap.count} 次复核</span> : null}
          </div>
        ) : (
          <span className="chip mute">还没复核过</span>
        )}
      </div>

      <div className="stack-sm">
        <div className="t-meta">相关资源</div>
        {resources.length === 0 ? (
          <div className="t-meta" style={{ padding: '12px 0' }}>
            当前暂无辅助资源
          </div>
        ) : (
          resources.map((r) =>
            r.resource_type === 'video' ? (
              <VideoPlayer key={r.resource_id} r={r} />
            ) : (
              <DocPreviewCard key={r.resource_id} r={r} />
            )
          )
        )}
      </div>

      <div className="stack-sm">
        <div className="t-meta">复核轨迹</div>
        {history.length === 0 ? (
          <div className="t-meta">还没有复核记录</div>
        ) : (
          history
            .slice()
            .reverse()
            .map((h, i) => (
              <div key={i} className={styles.detailRow}>
                <span>{STATUS[h.status].dot}</span>
                <span>{STATUS[h.status].label}</span>
                <span className="grow t-meta">第 {h.review} 次</span>
                <span className="t-meta">{new Date(h.date).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
              </div>
            ))
        )}
      </div>

      <button className="btn btn-block" onClick={() => navigate('/review')}>
        去本周复盘
      </button>
    </div>
  );
}

function dedupeByUrl<T extends { url?: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((item) => {
    const key = item.url || '';
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
