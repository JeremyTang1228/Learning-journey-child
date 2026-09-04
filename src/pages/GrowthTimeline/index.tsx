/**
 * GrowthTimeline —— 成长档案（深度打磨版）
 * 原型来源：03_UI_Prototype/GrowthTimeline.html
 * 落实 V1.1 Design Change 07：
 *   - 新增"这周先不复盘"跳过事件（弱化展示，灰色虚线，无状态色）
 *   - 补录角标（is_backfill → "补录"标签）
 *   - 日常"知识掌握"事件按周合并为一条摘要，点击展开明细
 *   - 里程碑 / 考试 / 录音 / 家长记录 保持独立卡片
 *
 * 事件来自 growth_records；按年级（小学六年）分年切换。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as userData from '@/services/userDataService';
import * as db from '@/services/storageService';
import { contentService } from '@/services/contentService';
import { useAppStore } from '@/store/appStore';
import { GRADE_ORDER, gradeIndex, STATUS } from '@/utils/status';
import { fmtWeekRange, fromISO, startOfWeek } from '@/utils/date';
import type { Assessment, AudioRecord, GrowthRecord, GrowthRecordType, KnowledgeStatus } from '@/types/user';
import { EmptyState, Loading, Sheet, StatusDot } from '@/components/ui';
import { SubjectTag } from '@/components/SubjectTag';
import { KnowledgeDetailSheet } from '@/components/KnowledgeDetailSheet';
import styles from './timeline.module.css';

interface TimelineEvent {
  id: string;
  type: GrowthRecordType;
  title: string;
  desc: string;
  date: string;
  isBackfill: boolean;
  /** 合并卡：展开明细 */
  merge?: { title: string; status: KnowledgeStatus; knowledge_id?: string; subject_id?: string }[];
  /** 单条知识卡：状态点颜色 */
  status?: KnowledgeStatus;
}

const DOT: Record<GrowthRecordType, string> = {
  milestone: '🏅',
  assessment: '📝',
  audio: '🎙️',
  note: '📝',
  weekly_review: '📋',
  knowledge: '✓',
  skip: '➖',
  map_progress: '🗺️',
};

function weekKeyOf(iso: string): string {
  return startOfWeek(fromISO(iso)).toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function GrowthTimeline() {
  const navigate = useNavigate();
  const child = useAppStore((s) => s.currentChild);
  const ready = useAppStore((s) => s.ready);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<GrowthRecord[]>([]);
  const [selectedGrade, setSelectedGrade] = useState<string>('');

  const gradeIdx = child ? gradeIndex(child.grade) : 0;

  const load = useCallback(async () => {
    if (!child) return;
    setLoading(true);
    setError(null);
    try {
      setRecords(await userData.getGrowthRecords(child.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : '档案加载失败');
    } finally {
      setLoading(false);
    }
  }, [child]);

  useEffect(() => {
    if (ready && child) {
      setSelectedGrade(child.grade);
      void load();
    } else if (ready) setLoading(false);
  }, [ready, child, load]);

  // 当前年级（含无 grade 标记的遗留记录归入当前年级）
  const inGrade = useMemo(
    () => records.filter((r) => (r.grade ?? child?.grade) === selectedGrade),
    [records, selectedGrade, child]
  );

  const events = useMemo<TimelineEvent[]>(() => {
    const knowledge = inGrade.filter((r) => r.type === 'knowledge');
    const others = inGrade.filter((r) => r.type !== 'knowledge');

    // 日常掌握按周合并
    const byWeek = new Map<string, GrowthRecord[]>();
    for (const r of knowledge) {
      const wk = weekKeyOf(r.record_date);
      if (!byWeek.has(wk)) byWeek.set(wk, []);
      byWeek.get(wk)!.push(r);
    }
    const merged: TimelineEvent[] = [...byWeek.entries()].map(([wk, list]) => {
      let mastered = 0;
      let attention = 0;
      const items: { title: string; status: KnowledgeStatus; knowledge_id?: string; subject_id?: string }[] = [];
      for (const r of list) {
        const st = (r.metadata?.status as KnowledgeStatus) ?? 'unreviewed';
        if (st === 'mastered' || st === 'basic') mastered += 1;
        else if (st === 'needs_review' || st === 'focus') attention += 1;
        const kn = r.knowledge_id ? contentService.getKnowledgeById(r.knowledge_id) : null;
        items.push({
          title: kn?.title ?? r.title.split(' · ')[0] ?? r.title,
          status: st,
          knowledge_id: r.knowledge_id ?? undefined,
          subject_id: kn?.subject_id,
        });
      }
      const range = fmtWeekRange(wk, addDays(wk, 6));
      return {
        id: `wk_${wk}`,
        type: 'knowledge',
        title: `这周复核了 ${list.length} 项`,
        desc: `${range} · ${mastered} 项掌握${attention ? `，${attention} 项需要加强` : ''}`,
        date: wk,
        isBackfill: list.some((r) => r.is_backfill),
        merge: items,
      };
    });

    const singles: TimelineEvent[] = others.map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      desc: r.description,
      date: r.record_date,
      isBackfill: r.is_backfill,
      status: (r.metadata?.status as KnowledgeStatus) || undefined,
    }));

    return [...singles, ...merged].sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [inGrade]);

  // 按月分组
  const months = useMemo(() => {
    const groups: { label: string; items: TimelineEvent[] }[] = [];
    for (const e of events) {
      const d = fromISO(e.date);
      const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      let g = groups.find((x) => x.label === label);
      if (!g) {
        g = { label, items: [] };
        groups.push(g);
      }
      g.items.push(e);
    }
    return groups;
  }, [events]);

  const summary = useMemo(() => {
    const knowledge = inGrade.filter((r) => r.type === 'knowledge').length;
    const exams = inGrade.filter((r) => r.type === 'assessment').length;
    const audio = inGrade.filter((r) => r.type === 'audio').length;
    return { knowledge, exams, audio };
  }, [inGrade]);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detailKnowledgeId, setDetailKnowledgeId] = useState<string | null>(null);
  const [summarySheet, setSummarySheet] = useState<'knowledge' | 'exam' | 'audio' | null>(null);

  if (!ready) return <div className="page"><Loading lines={4} /></div>;

  if (!child) {
    return (
      <div className="page">
        <EmptyState
          icon="🧒"
          title="先来认识一下孩子吧"
          desc="创建孩子之后，成长档案会开始记录"
          action={<button className="btn btn-primary" onClick={() => navigate('/settings')}>添加孩子</button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <header style={{ marginBottom: 4 }}>
        <div className="t-title">🌱 成长档案</div>
        <div className="t-sub" style={{ fontFamily: 'var(--font-hand)' }}>
          {child.name}的小学六年，一条会越走越长的路
        </div>
      </header>

      {/* 年级切换 */}
      <div className={styles.chips}>
        {GRADE_ORDER.map((g, i) => {
          const locked = i > gradeIdx;
          return (
            <button
              key={g}
              className={`${styles.chip}${g === selectedGrade ? ` ${styles.on}` : ''}${locked ? ` ${styles.locked}` : ''}`}
              disabled={locked}
              onClick={() => !locked && setSelectedGrade(g)}
            >
              {g}
              {locked ? ' 🔒' : ''}
            </button>
          );
        })}
      </div>

      {error ? (
        <EmptyState icon="🌧️" title="档案暂时打不开" desc={error} action={<button className="btn" onClick={() => void load()}>重新加载</button>} />
      ) : loading ? (
        <Loading lines={5} />
      ) : inGrade.length === 0 ? (
        <EmptyState
          icon="🌱"
          title="这一年还没有记录"
          desc="走到这一年之后，复盘、考试、录音都会慢慢出现在这里"
        />
      ) : (
        <>
          <div className={styles.summary}>
            <button className={styles.sumCard} onClick={() => setSummarySheet('knowledge')}>
              <div className={styles.sumNum} style={{ color: 'var(--green)' }}>{summary.knowledge}</div>
              <div className={styles.sumLbl}>知识点掌握</div>
            </button>
            <button className={styles.sumCard} onClick={() => setSummarySheet('exam')}>
              <div className={styles.sumNum} style={{ color: 'var(--kingdom)' }}>{summary.exams}</div>
              <div className={styles.sumLbl}>考试记录</div>
            </button>
            <button className={styles.sumCard} onClick={() => setSummarySheet('audio')}>
              <div className={styles.sumNum} style={{ color: 'var(--town)' }}>{summary.audio}</div>
              <div className={styles.sumLbl}>录音留存</div>
            </button>
          </div>

          <div className={styles.timeline}>
            {months.map((m) => (
              <div key={m.label}>
                <div className={styles.month}>{m.label}</div>
                {m.items.map((e) => (
                  <TimelineItem
                    key={e.id}
                    ev={e}
                    expanded={expanded === e.id}
                    onToggle={() => setExpanded(expanded === e.id ? null : e.id)}
                    onOpenKnowledge={setDetailKnowledgeId}
                  />
                ))}
              </div>
            ))}
          </div>

          <div className={styles.loadMore} onClick={() => showToast('更早的记录会在翻到对应年级时出现')}>
            加载更早的记录 ↑
          </div>

          <Sheet open={!!detailKnowledgeId} onClose={() => setDetailKnowledgeId(null)}>
            {child && detailKnowledgeId ? (
              <KnowledgeDetailSheet childId={child.id} knowledgeId={detailKnowledgeId} />
            ) : null}
          </Sheet>

          <Sheet open={!!summarySheet} onClose={() => setSummarySheet(null)}>
            {child && summarySheet ? (
              <SummarySheet
                childId={child.id}
                grade={selectedGrade}
                type={summarySheet}
                records={inGrade}
                onOpenKnowledge={setDetailKnowledgeId}
              />
            ) : null}
          </Sheet>
        </>
      )}
    </div>
  );
}

function TimelineItem({
  ev,
  expanded,
  onToggle,
  onOpenKnowledge,
}: {
  ev: TimelineEvent;
  expanded: boolean;
  onToggle: () => void;
  onOpenKnowledge?: (id: string) => void;
}) {
  const bySubject = useMemo(() => {
    if (!ev.merge) return null;
    const map = new Map<string, typeof ev.merge>();
    for (const it of ev.merge) {
      const sid = it.subject_id || 'unknown';
      if (!map.has(sid)) map.set(sid, []);
      map.get(sid)!.push(it);
    }
    return map;
  }, [ev.merge]);

  return (
    <div className={`${styles.item} ${styles[`type-${ev.type}`]}`}>
      <div className={styles.dot}>{DOT[ev.type]}</div>
      <div className={styles.card} onClick={ev.merge ? onToggle : undefined}>
        <div className={styles.cardTop}>
          <div className={styles.ttl}>{ev.title}</div>
          <div className="row" style={{ gap: 6, alignItems: 'center' }}>
            {ev.isBackfill ? <span className={styles.backfill}>补录</span> : null}
            <span className={styles.date}>{ev.date.slice(5)}</span>
          </div>
        </div>
        <div className={styles.desc}>{ev.desc}</div>
        {ev.merge ? (
          expanded ? (
            <div className={styles.mergeItems}>
              {[...(bySubject?.entries() ?? [])].map(([sid, items]) => (
                <div key={sid} className={styles.mergeGroup}>
                  <div className={styles.mergeSubj}>
                    <SubjectTag subjectId={sid} size="sm" />
                    <span className="t-meta">{items.length} 项</span>
                  </div>
                  {items.map((it, i) => (
                    <button
                      key={i}
                      className={styles.mergeRow}
                      disabled={!it.knowledge_id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (it.knowledge_id) onOpenKnowledge?.(it.knowledge_id);
                      }}
                    >
                      <StatusDot status={it.status} size="sm" />
                      <span className={styles.nm}>{it.title}</span>
                      {it.knowledge_id ? <span className={styles.mergeChev}>›</span> : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.tags}>
              <span className={styles.tag}>点开看这周复核了什么 ›</span>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 汇总卡片详情

function SummarySheet({
  childId,
  grade,
  type,
  records,
  onOpenKnowledge,
}: {
  childId: string;
  grade: string;
  type: 'knowledge' | 'exam' | 'audio';
  records: GrowthRecord[];
  onOpenKnowledge: (id: string) => void;
}) {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [audios, setAudios] = useState<(AudioRecord & { url?: string })[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  useEffect(() => {
    if (type === 'exam') {
      void userData.getAssessments(childId).then(setAssessments);
    } else if (type === 'audio') {
      void userData.getAudioRecords(childId).then(async (list) => {
        const withUrls = await Promise.all(
          list.map(async (r) => {
            const blob = await db.getAudioBlob(r.id);
            return blob ? { ...r, url: URL.createObjectURL(blob) } : r;
          })
        );
        setAudios(withUrls);
      });
    }
    return () => {
      audios.forEach((r) => r.url && URL.revokeObjectURL(r.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, childId]);

  if (type === 'knowledge') {
    const list = records.filter((r) => r.type === 'knowledge');
    const bySubject = new Map<string, GrowthRecord[]>();
    for (const r of list) {
      const kn = r.knowledge_id ? contentService.getKnowledgeById(r.knowledge_id) : null;
      const sid = kn?.subject_id || 'unknown';
      if (!bySubject.has(sid)) bySubject.set(sid, []);
      bySubject.get(sid)!.push(r);
    }
    return (
      <div className="stack">
        <div className="t-title">知识点掌握 ({list.length})</div>
        {list.length === 0 ? (
          <EmptyState icon="📚" title="还没有知识点记录" desc="完成本周复盘后，这里会汇总显示" />
        ) : (
          <div className="stack-sm">
            {[...(bySubject.entries())].map(([sid, items]) => (
              <div key={sid} className={styles.sumGroup}>
                <div className={styles.sumGroupTitle}>
                  <SubjectTag subjectId={sid} />
                  <span className="t-meta">{items.length} 项</span>
                </div>
                {items.map((r) => {
                  const st = (r.metadata?.status as KnowledgeStatus) ?? 'unreviewed';
                  const kn = r.knowledge_id ? contentService.getKnowledgeById(r.knowledge_id) : null;
                  return (
                    <button
                      key={r.id}
                      className={styles.sumListItem}
                      disabled={!r.knowledge_id}
                      onClick={() => r.knowledge_id && onOpenKnowledge(r.knowledge_id)}
                    >
                      <StatusDot status={st} size="sm" />
                      <span className={styles.sumListTitle}>{kn?.title ?? r.title.split(' · ')[0]}</span>
                      <span className="t-meta">{r.record_date.slice(5)}</span>
                      {r.knowledge_id ? <span className={styles.sumListChev}>›</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (type === 'exam') {
    const examRecords = records.filter((r) => r.type === 'assessment');
    const byId = new Map(assessments.map((a) => [a.id, a]));
    return (
      <div className="stack">
        <div className="t-title">考试记录 ({examRecords.length})</div>
        {examRecords.length === 0 ? (
          <EmptyState icon="📝" title="还没有考试记录" desc="在家长看板添加考试后，会出现在这里" />
        ) : (
          <div className="stack-sm">
            {examRecords.map((r) => {
              const aid = (r.metadata?.assessment_id as string) || '';
              const a = byId.get(aid);
              const subject = contentService.getSubject((r.metadata?.subject_id as string) || a?.subject_id || '');
              return (
                <div key={r.id} className={styles.sumListItemStatic}>
                  <span className={styles.sumListIcon}>📝</span>
                  <span className="grow">
                    <span className={styles.sumListTitle}>{r.title}</span>
                    <span className="t-meta" style={{ display: 'block' }}>
                      {subject?.map_name ?? '考试'} · {r.record_date}
                    </span>
                    {a?.note ? <span className="t-meta">{a.note}</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // audio
  const audioRecords = records.filter((r) => r.type === 'audio');
  const byId = new Map(audios.map((a) => [a.id, a]));
  return (
    <div className="stack">
      <div className="t-title">录音留存 ({audioRecords.length})</div>
      {audioRecords.length === 0 ? (
        <EmptyState icon="🎙️" title="还没有录音" desc="在知识点页录制讲解后，会出现在这里" />
      ) : (
        <div className="stack-sm">
          {audioRecords.map((r) => {
            const aid = (r.metadata?.audio_id as string) || '';
            const a = byId.get(aid);
            const isPlaying = playingId === aid;
            return (
              <div key={r.id} className={styles.sumListItemStatic}>
                <button
                  className={styles.audioPlayBtn}
                  onClick={() => {
                    if (!a?.url) return;
                    const audio = new Audio(a.url);
                    if (isPlaying) {
                      audio.pause();
                      setPlayingId(null);
                    } else {
                      setPlayingId(aid);
                      audio.play().catch(() => setPlayingId(null));
                      audio.onended = () => setPlayingId(null);
                    }
                  }}
                  disabled={!a?.url}
                  aria-label={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <span className="grow">
                  <span className={styles.sumListTitle}>{r.title}</span>
                  <span className="t-meta" style={{ display: 'block' }}>
                    {r.description} · {r.record_date}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function showToast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
