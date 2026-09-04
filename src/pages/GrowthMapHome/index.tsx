/**
 * GrowthMapHome —— 成长地图（默认首页）
 * 原型来源：03_UI_Prototype/GrowthMapHome.html
 *
 * 地图三条独立维度（第 48 节），本页不做成一个混合进度条：
 *   ① 我走到哪里了 = 学校学习进度（由 ProgressCheckIn 的显式确认驱动）
 *   ② 我掌握得怎么样 = 知识状态（五态色点）
 *   ③ 我经历过什么 = 成长记录（见成长档案页）
 *
 * V1.1 校准报告硬约束：
 *   - 头像位置只由「实际学习进度确认」驱动，绝不用实时计算的百分比（原则 2/3）
 *   - 学科区域由数据驱动渲染，不写死三个学科（Design Change 04）
 *   - ⚪ 未复核是中性态，不得渲染成负面（原则 5）
 *   - 🔴 不阻塞地图前进（原则 6）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentService, type HydratedKnowledge, type HydratedUnit } from '@/services/contentService';
import * as userData from '@/services/userDataService';
import { useAppStore } from '@/store/appStore';
import { GRADE_ORDER, STATUS, gradeIndex, landmarkIcon, needsAttention } from '@/utils/status';
import { greeting } from '@/utils/date';
import type { Subject } from '@/types/content';
import type { KnowledgeStatus } from '@/types/user';
import { Bar, EmptyState, Loading, Sheet, StatusBadge, StatusDot, SyncBadge } from '@/components/ui';
import Avatar from '@/components/Avatar';
import AudioRecorder from '@/components/AudioRecorder';
import { VideoPlayer } from '@/components/VideoPlayer';
import { DocPreviewCard } from '@/components/DocPreview';
import styles from './map.module.css';

/** 同 url 去重（如 ppt 与 ppt_preview 指向同一文件，避免重复展示） */
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

interface RegionStat {
  subject: Subject;
  units: HydratedUnit[];
  totalKn: number;
  /** 已复核过的知识点数（走过的路），不是掌握数 */
  reviewedKn: number;
  attention: number;
  /** 最近一次进度确认到达的单元下标，-1 表示还没确认过 */
  confirmedIdx: number;
}

type ExtraView =
  | { type: 'subject'; subject: Subject }
  | { type: 'unit'; unit: HydratedUnit }
  | { type: 'kn'; kn: HydratedKnowledge };

export default function GrowthMapHome() {
  const navigate = useNavigate();
  const child = useAppStore((s) => s.currentChild);
  const ready = useAppStore((s) => s.ready);
  const syncState = useAppStore((s) => s.syncState);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionStat[]>([]);
  const [statusMap, setStatusMap] = useState<Map<string, KnowledgeStatus>>(new Map());
  const [countMap, setCountMap] = useState<Map<string, number>>(new Map());

  const [openSubject, setOpenSubject] = useState<Subject | null>(null);
  const [openUnit, setOpenUnit] = useState<HydratedUnit | null>(null);
  const [openKn, setOpenKn] = useState<HydratedKnowledge | null>(null);
  const [extraStack, setExtraStack] = useState<ExtraView[]>([]);

  const grade = child?.grade ?? '一年级';
  const [viewGrade, setViewGrade] = useState(child?.grade ?? '一年级');
  useEffect(() => {
    setViewGrade(child?.grade ?? '一年级');
  }, [child]);

  // ---------------------------------------------------------------- 载入
  const load = useCallback(async () => {
    if (!child) return;
    setLoading(true);
    setError(null);
    try {
      await contentService.loadGrade(viewGrade);
      const subjects = contentService.getMapSubjects();
      const built: RegionStat[] = [];
      const allKnIds: string[] = [];

      for (const subject of subjects) {
        const units = contentService.getUnitsByGradeSubject(viewGrade, subject.subject_id);
        const knIds = units.flatMap((u) => contentService.getKnowledge(u.unit_id).map((k) => k.knowledge_id));
        allKnIds.push(...knIds);
        const checkIn = await userData.getLatestCheckIn(child.id, subject.subject_id);
        const confirmedIdx = checkIn?.actual_unit_id
          ? units.findIndex((u) => u.unit_id === checkIn.actual_unit_id)
          : -1;
        built.push({
          subject,
          units,
          totalKn: knIds.length,
          reviewedKn: 0,
          attention: 0,
          confirmedIdx,
        });
      }

      const snaps = await userData.getKnowledgeSnapshots(child.id, allKnIds);
      const sm = new Map<string, KnowledgeStatus>();
      const cm = new Map<string, number>();
      for (const [id, s] of snaps) {
        sm.set(id, s.status);
        cm.set(id, s.review_count);
      }
      for (const r of built) {
        const ids = r.units.flatMap((u) => contentService.getKnowledge(u.unit_id).map((k) => k.knowledge_id));
        r.reviewedKn = ids.filter((id) => sm.has(id)).length;
        r.attention = ids.filter((id) => needsAttention(sm.get(id) ?? 'unreviewed')).length;
      }
      setStatusMap(sm);
      setCountMap(cm);
      setRegions(built);
    } catch (e) {
      setError(e instanceof Error ? e.message : '地图加载失败');
    } finally {
      setLoading(false);
    }
  }, [child, viewGrade]);

  useEffect(() => {
    if (ready && child) void load();
    else if (ready) setLoading(false);
  }, [ready, child, load]);

  // ---------------------------------------------------------------- 派生

  const gradeIdx = gradeIndex(grade);
  const viewGradeIdx = gradeIndex(viewGrade);
  const hasAnyConfirmation = regions.some((r) => r.confirmedIdx >= 0);
  const hasAnyReview = statusMap.size > 0;

  /** 头像在路上的位置：只由各学科「已确认到达的单元」推进，绝不实时计算掌握率 */
  const avatarPct = useMemo(() => {
    if (!regions.length) return 0;
    const parts = regions.map((r) => {
      if (r.confirmedIdx < 0) return 0;
      return r.units.length ? (r.confirmedIdx + 1) / r.units.length : 0;
    });
    const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
    return Math.round(Math.min(1, avg) * 100);
  }, [regions]);

  const extraSubjects = contentService.getExtraSubjects();

  const prevGrade = GRADE_ORDER[gradeIdx - 1];
  const nextGrade = GRADE_ORDER[gradeIdx + 1];

  // ---------------------------------------------------------------- 渲染

  if (!ready) {
    return (
      <div className="page">
        <Loading lines={4} />
      </div>
    );
  }

  if (!child) {
    return (
      <div className="page">
        <EmptyState
          icon="🧒"
          title="先来认识一下孩子吧"
          desc="填好基本信息，成长地图就会为 TA 打开"
          action={
            <button className="btn btn-primary" onClick={() => navigate('/settings')}>
              添加孩子
            </button>
          }
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <EmptyState
          icon="🧭"
          title="地图暂时打不开"
          desc="网络好像不太稳定，检查一下再试试看"
          action={
            <button className="btn" onClick={() => void load()}>
              重新加载
            </button>
          }
        />
      </div>
    );
  }

  const openUnitKn = openUnit ? contentService.getKnowledge(openUnit.unit_id) : [];

  return (
    <div className="page">
      {/* 问候 */}
      <header className="row-between" style={{ marginBottom: 'var(--sp-lg)' }}>
        <button
          type="button"
          className="row"
          style={{ gap: 'var(--sp-md)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}
          onClick={() => navigate('/settings')}
          aria-label="进入设置"
        >
          <Avatar value={child.avatar} size={46} />
          <div>
            <div className="t-title">
              {greeting()}，{child.name} 👋
            </div>
            <div className="t-hand t-mute">
              {hasAnyReview ? '这周你又往前走了一点点～' : '完成第一次复盘，你就会往前走一点点～'}
            </div>
          </div>
        </button>
        <SyncBadge state={syncState} />
      </header>

      {/* 年级带 */}
      <section className="stack-sm" style={{ marginBottom: 'var(--sp-lg)' }}>
        <div className="t-meta">小学六年 · 成长旅程</div>
        <div className={styles.ribbon}>
          {GRADE_ORDER.map((g, i) => {
            const base = i < gradeIdx ? 'done' : i === gradeIdx ? 'current' : 'locked';
            const selected = i === viewGradeIdx ? ' ' + styles.selected : '';
            return (
              <button
                key={g}
                className={`${styles.ribbonItem} ${styles[base]}${selected}`}
                disabled={base === 'locked'}
                onClick={() => base !== 'locked' && setViewGrade(g)}
                title={base === 'locked' ? '走到这里才会展开' : g}
              >
                {g}
              </button>
            );
          })}
        </div>
      </section>

      {/* 地图画布 */}
      <section className={`card card-hero ${styles.canvas}`}>
        <div className="row-between" style={{ marginBottom: 'var(--sp-md)' }}>
          <div className="t-sub">{viewGrade} · 学科地图</div>
          <span className="t-meta">当前主场</span>
        </div>

        {loading ? (
          <Loading lines={2} />
        ) : (
          <div className={styles.road}>
            {/* 虚线小路 */}
            <svg className={styles.roadSvg} viewBox="0 0 100 300" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M50 6 C18 52 82 96 50 146 C18 196 82 240 50 294"
                fill="none"
                stroke="var(--road)"
                strokeWidth="2.5"
                strokeDasharray="6 7"
                strokeLinecap="round"
              />
            </svg>

            {/* 角色：位置只来自显式确认 */}
            <div
              className={styles.walker}
              style={{ top: `${6 + (avatarPct / 100) * 88}%` }}
              title="我在这里！"
            >
              <Avatar value={child.avatar} size={34} className={styles.walkerAvatar} />
              <span className={styles.walkerBubble}>{hasAnyConfirmation ? '我在这里！' : '准备出发'}</span>
            </div>

            {regions.map((r, i) => {
              const pct = r.totalKn ? Math.round((r.reviewedKn / r.totalKn) * 100) : 0;
              return (
                <button
                  key={r.subject.subject_id}
                  className={styles.region}
                  style={{
                    background: r.subject.color,
                    alignSelf: i % 2 === 0 ? 'flex-start' : 'flex-end',
                  }}
                  onClick={() => setOpenSubject(r.subject)}
                >
                  <span className={styles.regionIcon}>{r.subject.map_icon}</span>
                  <span className={styles.regionBody}>
                    <span className={styles.regionName}>{r.subject.map_name}</span>
                    <span className={styles.regionMeta}>已探索 {pct}%</span>
                    <span className={styles.regionBar}>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  </span>
                  {r.attention > 0 ? <span className={styles.regionDot} title={`${r.attention} 项值得关注`} /> : null}
                </button>
              );
            })}
          </div>
        )}

        <div className={styles.stations}>
          <div className={styles.station}>
            <span>🏅</span>
            <div>
              <div className="t-meta">上一站：{prevGrade ?? '起点'}</div>
              <div className="t-meta" style={{ opacity: 0.7 }}>
                {prevGrade ? '已走过，随时可以回去看看' : '旅程从这里开始'}
              </div>
            </div>
          </div>
          <div className={styles.station}>
            <span>🌫️</span>
            <div>
              <div className="t-meta">下一站：{nextGrade ?? '毕业'}</div>
              <div className="t-meta" style={{ opacity: 0.7 }}>
                {nextGrade ? '还在薄雾中，走到这里才会展开' : '小学旅程的终点'}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 兴趣拓展：其余学科收进次级入口（校准报告 Design Change 04） */}
      {extraSubjects.length > 0 ? (
        <section className="stack-sm" style={{ marginTop: 'var(--sp-lg)' }}>
          <div className="t-meta">🎒 兴趣拓展 · 其余 {extraSubjects.length} 个学科</div>
          <div className={styles.extraGrid}>
            {extraSubjects.map((s) => (
              <button
                key={s.subject_id}
                className={styles.extraItem}
                style={{ borderColor: s.color }}
                onClick={() => setExtraStack([{ type: 'subject', subject: s }])}
              >
                <span>{s.map_icon}</span>
                <span className="t-meta">{s.map_name}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {/* 学科区域 → 单元地标 */}
      <Sheet open={!!openSubject} onClose={() => setOpenSubject(null)}>
        {openSubject ? (
          <RegionSheet
            subject={openSubject}
            units={regions.find((r) => r.subject.subject_id === openSubject.subject_id)?.units ?? []}
            statusMap={statusMap}
            onPickUnit={(u) => setOpenUnit(u)}
          />
        ) : null}
      </Sheet>

      {/* 单元 → 知识点 */}
      <Sheet open={!!openUnit} onClose={() => setOpenUnit(null)}>
        {openUnit ? (
          <UnitSheet
            unit={openUnit}
            knowledge={openUnitKn}
            statusMap={statusMap}
            countMap={countMap}
            onPickKn={(k) => setOpenKn(k)}
          />
        ) : null}
      </Sheet>

      {/* 知识点详情 */}
      <Sheet open={!!openKn} onClose={() => setOpenKn(null)}>
        {openKn ? (
          <KnowledgeSheet kn={openKn} statusMap={statusMap} countMap={countMap} childId={child?.id ?? ''} />
        ) : null}
      </Sheet>

      {/* 兴趣拓展：学科 → 单元 → 知识点（不做复盘，只浏览内容与视频） */}
      <Sheet
        open={extraStack.length > 0}
        onClose={() => {
          setExtraStack((s) => {
            if (s.length <= 1) return [];
            return s.slice(0, -1);
          });
        }}
      >
        {extraStack.length > 0 ? (
          <ExtraStack
            top={extraStack[extraStack.length - 1]}
            grade={viewGrade}
            childId={child?.id ?? ''}
            onPush={(v) => setExtraStack((s) => [...s, v])}
          />
        ) : null}
      </Sheet>
    </div>
  );
}

function ExtraStack({
  top,
  grade,
  childId,
  onPush,
}: {
  top: ExtraView;
  grade: string;
  childId: string;
  onPush: (v: ExtraView) => void;
}) {
  if (top.type === 'subject') {
    const units = contentService.getUnitsByGradeSubject(grade, top.subject.subject_id);
    return (
      <RegionSheet
        subject={top.subject}
        units={units}
        statusMap={new Map()}
        onPickUnit={(u) => onPush({ type: 'unit', unit: u })}
        hideStatus
      />
    );
  }
  if (top.type === 'unit') {
    const knowledge = contentService.getKnowledge(top.unit.unit_id);
    return (
      <UnitSheet
        unit={top.unit}
        knowledge={knowledge}
        statusMap={new Map()}
        countMap={new Map()}
        onPickKn={(k) => onPush({ type: 'kn', kn: k })}
        hideStatus
      />
    );
  }
  return <KnowledgeSheet kn={top.kn} statusMap={new Map()} countMap={new Map()} childId={childId} hideStatus />;
}

// ---------------------------------------------------------------- 学科区域

function RegionSheet({
  subject,
  units,
  statusMap,
  onPickUnit,
  hideStatus,
}: {
  subject: Subject;
  units: HydratedUnit[];
  statusMap: Map<string, KnowledgeStatus>;
  onPickUnit: (u: HydratedUnit) => void;
  hideStatus?: boolean;
}) {
  if (!units.length) {
    return <EmptyState icon="🧭" title={`${subject.map_name} 还没有单元`} desc="这一年级暂时没有对应教材内容" />;
  }
  return (
    <div className="stack">
      <div className="row" style={{ gap: 'var(--sp-md)' }}>
        <span style={{ fontSize: 30 }}>{subject.map_icon}</span>
        <div>
          <div className="t-title">{subject.map_name}</div>
          <div className="t-meta">
            {subject.display_name} · 共 {units.length} 个单元{hideStatus ? '' : '地标'}
          </div>
        </div>
      </div>

      <div className="stack-sm">
        {units.map((u, i) => {
          const kns = contentService.getKnowledge(u.unit_id);
          const done = hideStatus ? 0 : kns.filter((k) => statusMap.has(k.knowledge_id)).length;
          const pct = hideStatus || !kns.length ? 0 : Math.round((done / kns.length) * 100);
          return (
            <button key={u.unit_id} className="card row" style={{ gap: 'var(--sp-md)', textAlign: 'left' }} onClick={() => onPickUnit(u)}>
              <span style={{ fontSize: 24 }}>{landmarkIcon(i)}</span>
              <span className="grow stack-sm" style={{ gap: 4 }}>
                <span className="t-body">{u.unit_name}</span>
                <span className="t-meta">
                  {kns.length} 个知识点{hideStatus ? '' : ` · 已走过 ${done} 个`}
                </span>
                {hideStatus ? null : <Bar pct={pct} color={subject.color} />}
              </span>
              <span className="t-mute">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 单元

function UnitSheet({
  unit,
  knowledge,
  statusMap,
  countMap,
  onPickKn,
  hideStatus,
}: {
  unit: HydratedUnit;
  knowledge: HydratedKnowledge[];
  statusMap: Map<string, KnowledgeStatus>;
  countMap: Map<string, number>;
  onPickKn: (k: HydratedKnowledge) => void;
  hideStatus?: boolean;
}) {
  if (!knowledge.length) {
    return <EmptyState icon="🧭" title="这个单元还没有知识点" desc="等内容补充后就会出现在这里" />;
  }
  return (
    <div className="stack">
      <div>
        <div className="t-title">{unit.unit_name}</div>
        <div className="t-meta">
          {unit.grade} · {unit.subject} · {unit.textbook}
          {unit.semester ? ` · ${unit.semester}` : ''}
        </div>
      </div>

      <div className="stack-sm">
        {knowledge.map((k) => {
          const st = statusMap.get(k.knowledge_id) ?? 'unreviewed';
          const n = countMap.get(k.knowledge_id) ?? 0;
          return (
            <button key={k.knowledge_id} className="card row" style={{ gap: 'var(--sp-md)', textAlign: 'left' }} onClick={() => onPickKn(k)}>
              {hideStatus ? null : <StatusDot status={st} size="lg" />}
              <span className="grow">
                <span className="t-body">{k.title}</span>
                <span className="t-meta" style={{ display: 'block' }}>
                  {hideStatus ? '点击查看具体内容' : `${STATUS[st].label}${n > 1 ? ` · 已复核 ${n} 次` : ''}`}
                </span>
              </span>
              <span className="t-mute">›</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 知识点

function KnowledgeSheet({
  kn,
  statusMap,
  countMap,
  childId,
  hideStatus,
}: {
  kn: HydratedKnowledge;
  statusMap: Map<string, KnowledgeStatus>;
  countMap: Map<string, number>;
  childId: string;
  hideStatus?: boolean;
}) {
  const st = statusMap.get(kn.knowledge_id) ?? 'unreviewed';
  const n = countMap.get(kn.knowledge_id) ?? 0;
  const resources = contentService.getResources(kn.knowledge_id, 3);

  return (
    <div className="stack">
      <div>
        <div className="t-meta">
          {kn.subject} · {kn.unit_name}
        </div>
        <div className="t-title" style={{ margin: '4px 0 8px' }}>
          {kn.title}
        </div>
        {hideStatus ? null : (
          <div className="row wrap" style={{ gap: 6 }}>
            <StatusBadge status={st} />
            {n > 0 ? <span className="chip mute">第 {n} 次复核</span> : null}
          </div>
        )}
      </div>

      {hideStatus ? null : n === 0 ? (
        <EmptyState
          icon="⚪"
          title="还没有复核过这个知识点"
          desc="等这周复盘之后，这里就会出现孩子和家长的记录"
        />
      ) : null}

      <div className="stack-sm">
        <div className="t-meta">相关资源</div>
        {resources.length === 0 ? (
          <div className="t-meta" style={{ padding: '12px 0' }}>
            当前暂无辅助资源
          </div>
        ) : (
          dedupeByUrl(resources).map((r) =>
            r.resource_type === 'video' ? (
              <VideoPlayer key={r.resource_id} r={r} />
            ) : (
              <DocPreviewCard key={r.resource_id} r={r} />
            )
          )
        )}
      </div>

      {hideStatus ? null : <AudioRecorder childId={childId} knowledgeId={kn.knowledge_id} />}
    </div>
  );
}
