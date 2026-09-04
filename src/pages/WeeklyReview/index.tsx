/**
 * WeeklyReview —— 本周复盘（MVP 第一核心功能）
 * 原型来源：03_UI_Prototype/WeeklyReview.html + ProgressCheckIn.html
 *
 * 目标：5～10 分钟完成（第 49 节）。手机端卡片 + 大按钮，不做表格（第 51 节）。
 *
 * 核心 UX：异常驱动（第 27 节）
 *   🟢/🟡 → 快速通过，0.8 秒后自动进入下一项
 *   🟠/🔴 → 展开支持面板（资源），处理完再走
 *
 * V1.1 校准报告 Design Change 03：
 *   - 必须有「这周先不复盘」入口，点击后 completion_status = skipped
 *   - 必须有「补录之前的复盘」入口，允许选择过去的日期
 *   - 全程零负面词汇（禁止"未完成/失败/落后"）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentService, type HydratedKnowledge, type HydratedUnit } from '@/services/contentService';
import * as userData from '@/services/userDataService';
import { useAppStore } from '@/store/appStore';
import { CHILD_RATINGS, PARENT_RATINGS, STATUS, STATUS_ORDER, isStable, landmarkIcon, needsAttention } from '@/utils/status';
import { fmtWeekRange, recentWeeks, todayISO, weekRange, type WeekRange } from '@/utils/date';
import type { ChildRating, ParentRating, ReviewItem } from '@/types/user';
import { Bar, EmptyState, Sheet, StatusDot, SyncBadge, showToast } from '@/components/ui';
import ProgressCheckIn from '@/components/ProgressCheckIn';
import { VideoPlayer } from '@/components/VideoPlayer';
import { DocPreviewCard } from '@/components/DocPreview';
import { SubjectTag } from '@/components/SubjectTag';
import { KnowledgeDetailSheet } from '@/components/KnowledgeDetailSheet';
import styles from './review.module.css';

/** 同 url 去重（如 ppt 与 ppt_preview 指向同一文件） */
function dedupeByUrl<T extends { url?: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const u = r.url;
    if (u) {
      if (seen.has(u)) return false;
      seen.add(u);
    }
    return true;
  });
}

type Step = 'entry' | 'checkin' | 'confirm' | 'review' | 'done';

interface Candidate {
  kn: HydratedKnowledge;
  include: boolean;
}

/** 按学科对候选分组（保持学科首次出现顺序，组内保持原序），用于"这周学了什么"分块区分语数英 */
function groupCandidatesBySubject(list: Candidate[]): { subjectId: string; items: Candidate[] }[] {
  const order: string[] = [];
  const map = new Map<string, Candidate[]>();
  for (const c of list) {
    const sid = c.kn.subject_id;
    if (!map.has(sid)) {
      map.set(sid, []);
      order.push(sid);
    }
    map.get(sid)!.push(c);
  }
  return order.map((sid) => ({ subjectId: sid, items: map.get(sid)! }));
}

export default function WeeklyReview() {
  const navigate = useNavigate();
  const child = useAppStore((s) => s.currentChild);
  const ready = useAppStore((s) => s.ready);
  const syncState = useAppStore((s) => s.syncState);

  const [step, setStep] = useState<Step>('entry');
  const [week, setWeek] = useState<WeekRange>(() => weekRange());
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [existingStatus, setExistingStatus] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [idx, setIdx] = useState(0);
  const [childRating, setChildRating] = useState<ChildRating | null>(null);
  const [parentRating, setParentRating] = useState<ParentRating | null>(null);
  const [savedItems, setSavedItems] = useState<Map<string, ReviewItem>>(new Map());
  const [expandSupport, setExpandSupport] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const [pickWeekOpen, setPickWeekOpen] = useState(false);
  const [addUnitOpen, setAddUnitOpen] = useState(false);
  const [stats, setStats] = useState({ stable: 0, attention: 0 });
  const [loadingReview, setLoadingReview] = useState(false);

  const [listOpen, setListOpen] = useState(false);
  const [listFilter, setListFilter] = useState<{ type: 'stable' } | { type: 'attention' } | { type: 'subject'; subjectId: string } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  // ---------------------------------------------------------------- 进入
  const beginWeek = useCallback(
    async (w: WeekRange, isBackfill: boolean) => {
      if (!child) return;
      setLoadingReview(true);
      setWeek(w);
      const rev = await userData.getOrCreateReview(child.id, w.week_start, isBackfill);
      setReviewId(rev.id);
      setExistingStatus(rev.status);
      const map = await userData.getReviewItemsMap(rev.id);
      setSavedItems(map);
      setLoadingReview(false);
      setPickWeekOpen(false);
      if (rev.status === 'completed') {
        setStep('done');
        return;
      }
      setStep('checkin');
    },
    [child]
  );

  useEffect(() => {
    if (ready && child) void beginWeek(weekRange(), false);
    // 仅在首次进入时自动定位到本周
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, child]);

  // ---------------------------------------------------------------- 进度确认后 → 生成候选
  const afterCheckIn = useCallback(
    async (grade: string) => {
      const checkIns = await userData.getCheckIns(child!.id);
      const thisWeek = checkIns.filter((c) => c.week_start === week.week_start);
      const unitIds = [...new Set(thisWeek.map((c) => c.actual_unit_id).filter(Boolean) as string[])];

      // 没有确认过任何单元 → 允许家长直接手动挑单元，不阻塞
      const kns: HydratedKnowledge[] = [];
      for (const uid of unitIds) kns.push(...contentService.getKnowledge(uid));

      const seen = new Set(kns.map((k) => k.knowledge_id));
      setCandidates(kns.map((kn) => ({ kn, include: !savedItems.has(kn.knowledge_id) })));
      setIdx(0);
      setStep(kns.length || seen.size ? 'confirm' : 'confirm');
    },
    [child, week.week_start, savedItems]
  );

  // ---------------------------------------------------------------- 逐项保存

  const queue = useMemo(() => candidates.filter((c) => c.include), [candidates]);
  const current = queue[Math.min(idx, queue.length - 1)] ?? null;

  const saveCurrent = useCallback(
    async (cr: ChildRating | null, pr: ParentRating) => {
      if (!current || !child || !reviewId) return;
      const status = PARENT_RATINGS.find((r) => r.key === pr)!.status;
      const existing = savedItems.get(current.kn.knowledge_id);
      if (existing) {
        await userData.updateReviewItem(existing.id, {
          child_rating: cr,
          parent_rating: pr,
          knowledge_status: status,
        });
        setSavedItems((m) => new Map(m).set(current.kn.knowledge_id, { ...existing, child_rating: cr, parent_rating: pr, knowledge_status: status }));
      } else {
        const item = await userData.saveReviewItem({
          child_id: child.id,
          review_id: reviewId,
          knowledge_id: current.kn.knowledge_id,
          child_rating: cr,
          parent_rating: pr,
          knowledge_status: status,
        });
        setSavedItems((m) => new Map(m).set(current.kn.knowledge_id, item));
      }
    },
    [current, child, reviewId, savedItems]
  );

  const goNext = useCallback(() => {
    setChildRating(null);
    setParentRating(null);
    setExpandSupport(false);
    setAdvancing(false);
    setIdx((i) => Math.min(i + 1, queue.length));
  }, [queue.length]);

  const onPickParent = (pr: ParentRating) => {
    if (!current) return;
    setParentRating(pr);
    void saveCurrent(childRating, pr);
    const status = PARENT_RATINGS.find((r) => r.key === pr)!.status;
    if (isStable(status)) {
      // 正常项：快速通过
      setAdvancing(true);
      setTimeout(() => {
        if (idx + 1 >= queue.length) void finish();
        else goNext();
      }, 800);
    } else {
      // 异常项：展开支持面板
      setExpandSupport(true);
    }
  };

  // ---------------------------------------------------------------- 完成

  const finish = useCallback(async () => {
    if (!reviewId || !child) return;
    const items = await userData.getReviewItemsByReview(reviewId);
    let stable = 0;
    let attention = 0;
    for (const it of items) {
      if (isStable(it.knowledge_status)) stable += 1;
      if (needsAttention(it.knowledge_status)) attention += 1;
    }
    setStats({ stable, attention });
    await userData.setReviewStatus(reviewId, 'completed');

    // 已写过成长记录则跳过（避免"再做一次"重复生成）
    const existing = await userData.getGrowthRecords(child.id);
    const alreadyTracked = existing.some((g) => g.type === 'knowledge' && g.metadata?.review_id === reviewId);
    if (!alreadyTracked) {
      await contentService.loadGrade(child.grade);
      for (const it of items) {
        if (it.knowledge_status === 'unreviewed') continue;
        const kn = contentService.getKnowledgeById(it.knowledge_id);
        const label = STATUS[it.knowledge_status].label;
        await userData.createGrowthRecord({
          child_id: child.id,
          type: 'knowledge',
          title: `${kn?.title ?? '知识点'} · ${label}`,
          description: `${STATUS[it.knowledge_status].dot} ${it.knowledge_status === 'needs_review' || it.knowledge_status === 'focus' ? '再练练就好' : '稳了'}`,
          record_date: todayISO(),
          knowledge_id: it.knowledge_id,
          grade: child.grade,
          metadata: { review_id: reviewId, knowledge_id: it.knowledge_id, status: it.knowledge_status, review_count: it.review_count },
        });
      }
    }

    await userData.createGrowthRecord({
      child_id: child.id,
      type: 'weekly_review',
      title: `完成第 ${week.week_no} 周复盘`,
      description: `共复核 ${items.length} 项，${stable} 项掌握不错`,
      record_date: todayISO(),
      is_backfill: week.week_start !== weekRange().week_start,
      grade: child.grade,
      metadata: { review_id: reviewId, week_start: week.week_start },
    });
    setStep('done');
  }, [reviewId, child, week]);

  const skipWeek = useCallback(async () => {
    if (!child) return;
    const rev = reviewId ? { id: reviewId } : await userData.getOrCreateReview(child.id, week.week_start, false);
    await userData.setReviewStatus(rev.id, 'skipped');
    await userData.createGrowthRecord({
      child_id: child.id,
      type: 'skip',
      title: '这周先不复盘',
      description: '好的，我们下周再继续～',
      record_date: todayISO(),
      grade: child.grade,
      metadata: { week_start: week.week_start },
    });
    showToast('好的，我们下周再继续～');
    setStep('entry');
    setExistingStatus('skipped');
  }, [reviewId, child, week.week_start]);

  // ---------------------------------------------------------------- 渲染

  if (!ready) {
    return (
      <div className="page">
        <EmptyState icon="⏳" title="正在准备本周复盘" />
      </div>
    );
  }

  if (!child) {
    return (
      <div className="page">
        <EmptyState
          icon="🧒"
          title="先来认识一下孩子吧"
          desc="创建孩子之后就可以开始每周复盘"
          action={
            <button className="btn btn-primary" onClick={() => navigate('/settings')}>
              添加孩子
            </button>
          }
        />
      </div>
    );
  }

  const progressPct = queue.length ? Math.round((Math.min(idx, queue.length) / queue.length) * 100) : 0;

  return (
    <div className="page">
      {/* 顶部 */}
      <header className="row-between" style={{ marginBottom: 'var(--sp-lg)' }}>
        <div>
          <div className="t-title">📋 本周复盘</div>
          <div className="t-meta">
            {fmtWeekRange(week.week_start, week.week_end)} · 第 {week.week_no} 周
            {week.week_start !== weekRange().week_start ? ' · 补录' : ''}
          </div>
        </div>
        <SyncBadge state={syncState} />
      </header>

      {/* Step: 入口 */}
      {step === 'entry' ? (
        <div className="stack">
          <div className="card card-hero center stack-sm">
            <div style={{ fontSize: 40 }}>📋</div>
            <div className="t-sub">
              {existingStatus === 'skipped' ? '这周先不复盘，我们下周继续' : '准备好看看这一周了吗？'}
            </div>
            <div className="t-meta">
              {fmtWeekRange(week.week_start, week.week_end)} · 大约 5 分钟
            </div>
          </div>

          <button className="btn btn-primary btn-lg btn-block" onClick={() => setStep('checkin')}>
            开始本周复盘
          </button>
          <button className="btn btn-block" onClick={() => setPickWeekOpen(true)}>
            补录之前的复盘
          </button>
          <button className="btn-text center" onClick={() => void skipWeek()}>
            这周先不复盘
          </button>
        </div>
      ) : null}

      {/* Step: 进度确认 */}
      {step === 'checkin' ? (
        loadingReview ? (
          <EmptyState icon="⏳" title="正在准备…" />
        ) : (
          <ProgressCheckIn
            childId={child.id}
            weekStart={week.week_start}
            grade={child.grade}
            subjects={contentService.getMapSubjects().map((s) => ({
              subject_id: s.subject_id,
              map_name: s.map_name,
              map_icon: s.map_icon,
              color: s.color,
            }))}
            onDone={() => void afterCheckIn(child.grade)}
          />
        )
      ) : null}

      {/* Step: 本周学了什么 */}
      {step === 'confirm' ? (
        <div className="stack">
          <div>
            <div className="t-sub">这周学校学了什么？</div>
            <div className="t-meta">
              {candidates.length
                ? '下面的内容来自你刚刚确认的进度，不对的话点掉就行'
                : '这周还没有课表数据，你可以直接手动添加'}
            </div>
          </div>

          <div className="stack-sm">
            {candidates.length === 0 ? (
              <div className="t-meta">这周还没有课表数据，你可以直接手动添加</div>
            ) : (
              groupCandidatesBySubject(candidates).map((grp) => {
                const color = contentService.getSubject(grp.subjectId)?.color;
                return (
                  <div key={grp.subjectId} className={styles.subjGroup}>
                    <div className={styles.subjGroupHead}>
                      <SubjectTag subjectId={grp.subjectId} size="sm" />
                      <span className={styles.subjGroupCount}>{grp.items.length} 项</span>
                    </div>
                    {grp.items.map((c) => (
                      <button
                        key={c.kn.knowledge_id}
                        className={`card row ${styles.item} ${c.include ? '' : styles.itemOff}`}
                        style={color ? { borderLeft: `4px solid ${color}` } : undefined}
                        onClick={() =>
                          setCandidates((list) =>
                            list.map((x) => (x.kn.knowledge_id === c.kn.knowledge_id ? { ...x, include: !x.include } : x))
                          )
                        }
                      >
                        <span className={styles.check}>{c.include ? '☑️' : '⬜️'}</span>
                        <span className="grow">
                          <span className="t-body">{c.kn.title}</span>
                          <span className="t-meta" style={{ display: 'block' }}>
                            <SubjectTag subjectId={c.kn.subject_id} size="sm" /> · {c.kn.unit_name}
                          </span>
                        </span>
                        {savedItems.has(c.kn.knowledge_id) ? <span className="t-meta">已评</span> : null}
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>

          <button className="btn btn-block" onClick={() => setAddUnitOpen(true)}>
            ➕ 添加一项没列出来的内容
          </button>

          <button
            className="btn btn-primary btn-lg btn-block"
            disabled={!queue.length}
            onClick={() => {
              setIdx(0);
              setChildRating(null);
              setParentRating(null);
              setExpandSupport(false);
              setStep('review');
            }}
          >
            确认，开始复盘（{queue.length} 项）
          </button>
          {!queue.length ? <div className="t-meta center">至少选一项才能开始哦</div> : null}
        </div>
      ) : null}

      {/* Step: 逐项复盘 */}
      {step === 'review' && current ? (
        <div className="stack">
          <div className="row-between">
            <span className="t-meta">
              第 {Math.min(idx + 1, queue.length)} / {queue.length} 项
            </span>
            <span className="grow" style={{ maxWidth: 160 }}>
              <Bar pct={progressPct} color="var(--cta)" />
            </span>
          </div>

          <div
            className="card card-hero stack"
            style={(() => {
              const color = contentService.getSubject(current.kn.subject_id)?.color;
              return color ? { borderLeft: `5px solid ${color}` } : undefined;
            })()}
          >
            <div>
              <div className="t-meta" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <SubjectTag subjectId={current.kn.subject_id} /> · {current.kn.unit_name}
              </div>
              <div className="t-title" style={{ marginTop: 4, fontSize: 22 }}>
                {current.kn.title}
              </div>
            </div>

            {/* 孩子自评 */}
            <div className="stack-sm">
              <div className="t-meta">孩子怎么说？</div>
              <div className={styles.rateRow}>
                {CHILD_RATINGS.map((r) => (
                  <button
                    key={r.key}
                    className={`${styles.rate} ${childRating === r.key ? styles.rateOn : ''}`}
                    onClick={() => setChildRating(r.key)}
                    aria-pressed={childRating === r.key}
                  >
                    <span className={styles.rateEmoji}>{r.emoji}</span>
                    <span className={styles.rateLabel}>{r.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 家长判断 */}
            <div className="stack-sm">
              <div className="t-meta">家长怎么看？</div>
              <div className={styles.rateRow}>
                {PARENT_RATINGS.map((r) => (
                  <button
                    key={r.key}
                    className={`${styles.rate} ${parentRating === r.key ? styles.rateOn : ''}`}
                    disabled={!childRating}
                    onClick={() => onPickParent(r.key)}
                    aria-pressed={parentRating === r.key}
                  >
                    <span className={styles.rateEmoji}>
                      <StatusDot status={r.status} size="lg" />
                    </span>
                    <span className={styles.rateLabel}>{r.label}</span>
                  </button>
                ))}
              </div>
              {!childRating ? <div className="t-meta">先听听孩子怎么说～</div> : null}
            </div>

            {/* 异常支持面板 */}
            {expandSupport && parentRating ? (
              <div className={styles.support}>
                <div className="t-meta">
                  {STATUS[PARENT_RATINGS.find((r) => r.key === parentRating)!.status].hint}，要不要看看～
                </div>
                <SupportPanel kn={current.kn} />
                <button className="btn btn-primary btn-block" onClick={goNext}>
                  知道了，下一项 →
                </button>
              </div>
            ) : null}

            {advancing ? (
              <div className="t-hand center" style={{ color: 'var(--green)' }}>
                掌握得不错，一带而过 ✓
              </div>
            ) : null}
          </div>

          <div className="row" style={{ gap: 'var(--sp-sm)' }}>
            <button className="btn grow" disabled={idx === 0} onClick={() => setIdx((i) => Math.max(0, i - 1))}>
              上一项
            </button>
            <button
              className="btn grow"
              onClick={() => {
                if (idx + 1 >= queue.length) void finish();
                else goNext();
              }}
            >
              下一项 →
            </button>
          </div>
          <button className="btn-text center" onClick={() => void finish()}>
            先到这里，完成复盘
          </button>
        </div>
      ) : null}

      {/* Step: 完成 */}
      {step === 'done' ? (
        <div className="stack">
          <div className="card card-hero center stack">
            <div style={{ fontSize: 48 }}>🎉</div>
            <div className="t-title">这周复盘完成啦！</div>
            <div className="t-hand t-mute">{child.name}这周又往前走了一点点～</div>
            <div className="row" style={{ gap: 'var(--sp-2xl)', justifyContent: 'center', marginTop: 8 }}>
              <button
                className={styles.statCard}
                onClick={() => {
                  setListFilter({ type: 'stable' });
                  setListOpen(true);
                }}
              >
                <div className="t-title" style={{ fontSize: 26, color: 'var(--green)' }}>
                  {stats.stable}
                </div>
                <div className="t-meta">已掌握 / 基本掌握</div>
              </button>
              <button
                className={styles.statCard}
                onClick={() => {
                  setListFilter({ type: 'attention' });
                  setListOpen(true);
                }}
              >
                <div className="t-title" style={{ fontSize: 26, color: 'var(--orange)' }}>
                  {stats.attention}
                </div>
                <div className="t-meta">需要加强 / 重点关注</div>
              </button>
            </div>
          </div>

          {/* 分学科一览 */}
          <div className="card stack-sm">
            <div className="t-sub">分学科一览</div>
            {(() => {
              const bySubj = new Map<string, { total: number; stable: number }>();
              for (const [kid, item] of savedItems) {
                const sid = contentService.getKnowledgeById(kid)?.subject_id;
                if (!sid) continue;
                const e = bySubj.get(sid) ?? { total: 0, stable: 0 };
                e.total += 1;
                if (isStable(item.knowledge_status)) e.stable += 1;
                bySubj.set(sid, e);
              }
              const subs = [...bySubj.entries()];
              if (!subs.length) return <div className="t-meta">这周还没有可统计的复核项</div>;
              return subs.map(([sid, e]) => {
                const color = contentService.getSubject(sid)?.color;
                return (
                  <button
                    key={sid}
                    className={styles.subjSummaryRow}
                    style={color ? { borderLeft: `4px solid ${color}` } : undefined}
                    onClick={() => {
                      setListFilter({ type: 'subject', subjectId: sid });
                      setListOpen(true);
                    }}
                  >
                    <SubjectTag subjectId={sid} size="sm" />
                    <span className="grow t-meta">{e.total} 项复核</span>
                    <span className="t-meta" style={{ color: 'var(--green)' }}>{e.stable} 项稳了</span>
                    <span className={styles.listChev}>›</span>
                  </button>
                );
              });
            })()}
          </div>

          <SyncBadge state={syncState} />

          <button className="btn btn-primary btn-lg btn-block" onClick={() => navigate('/')}>
            回到地图看看 🗺️
          </button>
          <button className="btn-text center" onClick={() => setStep('entry')}>
            再做一次本周复盘
          </button>
        </div>
      ) : null}

      {/* 补录选周 */}
      <Sheet open={pickWeekOpen} onClose={() => setPickWeekOpen(false)}>
        <div className="stack">
          <div className="t-sub">补录之前的复盘</div>
          <div className="t-meta">选一个过去的一周，流程和本周完全一样</div>
          <div className="stack-sm">
            {recentWeeks(8)
              .filter((w) => w.week_start !== weekRange().week_start)
              .map((w) => (
                <button
                  key={w.week_start}
                  className="card row-between"
                  onClick={() => void beginWeek(w, true)}
                >
                  <span className="t-body">第 {w.week_no} 周</span>
                  <span className="t-meta">{fmtWeekRange(w.week_start, w.week_end)}</span>
                </button>
              ))}
          </div>
        </div>
      </Sheet>

      {/* 手动添加内容 */}
      <Sheet open={addUnitOpen} onClose={() => setAddUnitOpen(false)}>
        <AddUnitSheet
          grade={child.grade}
          onAdd={(unit) => {
            const kns = contentService.getKnowledge(unit.unit_id);
            setCandidates((list) => {
              const have = new Set(list.map((c) => c.kn.knowledge_id));
              const add = kns.filter((k) => !have.has(k.knowledge_id)).map((kn) => ({ kn, include: true }));
              return [...list, ...add];
            });
            setAddUnitOpen(false);
            showToast(`已加入「${unit.unit_name}」的知识点`);
          }}
        />
      </Sheet>

      {/* 复盘完成页：知识点列表 */}
      <Sheet open={listOpen} onClose={() => setListOpen(false)}>
        {listFilter ? (
          <ReviewItemListSheet
            items={(() => {
              const all = [...savedItems.values()];
              if (listFilter.type === 'stable') return all.filter((it) => isStable(it.knowledge_status));
              if (listFilter.type === 'attention') return all.filter((it) => needsAttention(it.knowledge_status));
              return all.filter((it) => contentService.getKnowledgeById(it.knowledge_id)?.subject_id === listFilter.subjectId);
            })()}
            title={(() => {
              if (listFilter.type === 'stable') return '已掌握 / 基本掌握';
              if (listFilter.type === 'attention') return '需要加强 / 重点关注';
              const subj = contentService.getSubject(listFilter.subjectId);
              return `${subj?.map_name ?? ''} · 复核项目`;
            })()}
            onClose={() => setListOpen(false)}
            onDetail={(id) => setDetailId(id)}
          />
        ) : null}
      </Sheet>

      {/* 知识点详情 */}
      <Sheet open={!!detailId} onClose={() => setDetailId(null)}>
        {detailId && child ? <KnowledgeDetailSheet childId={child.id} knowledgeId={detailId} /> : null}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- 知识点列表（完成页）

function ReviewItemListSheet({ items, title, onClose, onDetail }: { items: ReviewItem[]; title: string; onClose: () => void; onDetail: (id: string) => void }) {
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const ai = STATUS_ORDER.indexOf(a.knowledge_status);
      const bi = STATUS_ORDER.indexOf(b.knowledge_status);
      return ai - bi;
    });
  }, [items]);

  return (
    <div className="stack">
      <div className="t-sub">{title}</div>
      {sorted.length === 0 ? (
        <div className="t-meta">暂无对应记录</div>
      ) : (
        <div className="stack-sm">
          {sorted.map((it) => {
            const kn = contentService.getKnowledgeById(it.knowledge_id);
            if (!kn) return null;
            const color = contentService.getSubject(kn.subject_id)?.color;
            return (
              <button
                key={it.knowledge_id}
                className={styles.listItem}
                style={color ? { borderLeft: `4px solid ${color}` } : undefined}
                onClick={() => onDetail(it.knowledge_id)}
              >
                <StatusDot status={it.knowledge_status} size="lg" />
                <span className="grow" style={{ minWidth: 0 }}>
                  <div className={styles.listTitle}>{kn.title}</div>
                  <div className={styles.listMeta}>
                    <SubjectTag subjectId={kn.subject_id} size="sm" /> · {kn.unit_name}
                    {it.review_count > 1 ? ` · 已复核 ${it.review_count} 次` : ''}
                  </div>
                </span>
                <span className={styles.listChev}>›</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 支持面板

function SupportPanel({ kn }: { kn: HydratedKnowledge }) {
  const resources = contentService.getResources(kn.knowledge_id, 3);
  if (!resources.length) {
    return <div className="t-meta">当前暂无辅助资源，可以自己找一段讲给 TA 听。</div>;
  }
  return (
    <div className="stack-sm">
      {dedupeByUrl(resources).map((r) =>
        r.resource_type === 'video' ? (
          <VideoPlayer key={r.resource_id} r={r} />
        ) : (
          <DocPreviewCard key={r.resource_id} r={r} />
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 手动挑单元

function AddUnitSheet({ grade, onAdd }: { grade: string; onAdd: (u: HydratedUnit) => void }) {
  const [subjectId, setSubjectId] = useState<string>(() => contentService.getMapSubjects()[0]?.subject_id ?? '');
  const subjects = contentService.getMapSubjects();
  const units = useMemo(
    () => (subjectId ? contentService.getUnitsByGradeSubject(grade, subjectId) : []),
    [grade, subjectId]
  );

  return (
    <div className="stack">
      <div className="t-sub">添加一项没列出来的内容</div>
      <div className="scroll-x">
        {subjects.map((s) => (
          <button key={s.subject_id} className={`chip${subjectId === s.subject_id ? ' on' : ''}`} onClick={() => setSubjectId(s.subject_id)}>
            {s.map_icon} {s.map_name}
          </button>
        ))}
      </div>
      <div className="stack-sm">
        {units.length === 0 ? (
          <div className="t-meta">这一年级暂时没有该学科的单元</div>
        ) : (
          units.map((u, i) => (
            <button key={u.unit_id} className="card row" style={{ textAlign: 'left' }} onClick={() => onAdd(u)}>
              <span style={{ fontSize: 20 }}>{landmarkIcon(i)}</span>
              <span className="grow">
                <span className="t-body">{u.unit_name}</span>
                <span className="t-meta" style={{ display: 'block' }}>
                  {u.knowledge_count} 个知识点
                </span>
              </span>
              <span className="t-mute">＋</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
