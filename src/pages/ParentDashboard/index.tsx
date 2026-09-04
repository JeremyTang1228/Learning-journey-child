/**
 * ParentDashboard —— 家长看板（深度打磨版）
 * 原型来源：03_UI_Prototype/ParentDashboard.html
 * 落实 V1.1 Design Change 05：补充「本周学了什么」与「最近一次考试」两张摘要卡。
 *
 * 看板不是后台（第 54 节）：只回答"孩子本周状态怎么样"。
 *   - 本周掌握度环形图（基于本周复盘知识点的掌握情况：学会 vs 不会）+ 相比上周
 *   - 本周学了什么（按学科分组，可展开「查看更多」具体知识点）
 *   - 需要关注（≤3，按 review_count 降序，🔴 优先于 🟠）
 *   - 最近一次考试（点击查看 / 新增）
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentService } from '@/services/contentService';
import * as userData from '@/services/userDataService';
import { useAppStore } from '@/store/appStore';
import { isStable, needsAttention } from '@/utils/status';
import { fmtWeekRange, todayISO, weekRange } from '@/utils/date';
import type { Assessment, KnowledgeStatus, ReviewItem } from '@/types/user';
import { EmptyState, Loading, Ring, Sheet, StatusDot, SyncBadge, showToast } from '@/components/ui';
import { SubjectTag } from '@/components/SubjectTag';
import { KnowledgeDetailSheet } from '@/components/KnowledgeDetailSheet';
import styles from './dashboard.module.css';

interface LearnedUnit {
  unitId: string;
  unitName: string;
  knowledge: { knowledgeId: string; title: string }[];
}
interface LearnedSubject {
  subjectId: string;
  icon: string;
  subjectName: string;
  color?: string;
  units: LearnedUnit[];
}

export default function ParentDashboard() {
  const navigate = useNavigate();
  const child = useAppStore((s) => s.currentChild);
  const ready = useAppStore((s) => s.ready);
  const syncState = useAppStore((s) => s.syncState);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overall, setOverall] = useState(0);
  const [delta, setDelta] = useState(0);
  const [weekStats, setWeekStats] = useState<{ total: number; stable: number; attention: number }>({ total: 0, stable: 0, attention: 0 });
  const [attention, setAttention] = useState<{ id: string; title: string; subjectId: string; unit: string; status: KnowledgeStatus; count: number }[]>([]);
  const [learned, setLearned] = useState<LearnedSubject[]>([]);
  const [lastExam, setLastExam] = useState<Assessment | null>(null);
  const [examOpen, setExamOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [learnedOpen, setLearnedOpen] = useState(false);
  const [learnedSubject, setLearnedSubject] = useState<string | null>(null);
  const [learnedDetailId, setLearnedDetailId] = useState<string | null>(null);

  const grade = child?.grade ?? '一年级';

  const load = useCallback(async () => {
    if (!child) return;
    setLoading(true);
    setError(null);
    try {
      await contentService.loadGrade(grade);
      const cur = weekRange();

      // 整体掌握度 → 基于「本周复盘的知识点」整体掌握情况：
      // 取本周复盘条目，按孩子掌握 + 父母确认得到的状态，统计"学会的(已掌握/基本掌握)" vs "不会的(需要加强/重点关注)"占比
      const reviews = await userData.getReviews(child.id);
      const thisWeekRev = reviews.find((r) => r.week_start === cur.week_start);
      let weekItems: ReviewItem[] = [];
      if (thisWeekRev) {
        const m = await userData.getReviewItemsMap(thisWeekRev.id);
        weekItems = [...m.values()];
      }
      const totalW = weekItems.length;
      const stableW = weekItems.filter((i) => isStable(i.knowledge_status)).length;
      const attW = weekItems.filter((i) => needsAttention(i.knowledge_status)).length;
      setOverall(totalW ? Math.round((stableW / totalW) * 100) : 0);
      setWeekStats({ total: totalW, stable: stableW, attention: attW });

      // 相比上周：本周 vs 上周新增"已掌握/基本掌握"项数
      const items = await userData.getReviewItems(child.id);
      const prev = (() => {
        const d = new Date(`${cur.week_start}T00:00:00`);
        d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      })();
      const now = new Date().toISOString();
      const thisGain = items.filter((i) => isStable(i.knowledge_status) && i.created_at >= cur.week_start && i.created_at <= now).length;
      const lastGain = items.filter((i) => isStable(i.knowledge_status) && i.created_at >= prev && i.created_at < cur.week_start).length;
      setDelta(thisGain - lastGain);

      // 需要关注（≤3，按 review_count 降序，🔴 优先🟠）
      const att = await userData.getAttentionItems(child.id, 3);
      setAttention(
        att.map((it) => {
          const kn = contentService.getKnowledgeById(it.knowledge_id);
          return {
            id: it.knowledge_id,
            title: kn?.title ?? '知识点',
            subjectId: kn?.subject_id ?? '',
            unit: kn?.unit_name ?? '',
            status: it.knowledge_status,
            count: it.review_count,
          };
        })
      );

      // 本周学了什么（进度确认）—— 按学科分组，可展开到具体知识点
      const checkIns = await userData.getCheckIns(child.id);
      const wkCheckins = checkIns.filter((c) => c.week_start === cur.week_start && c.actual_unit_id);
      const bySubj = new Map<string, LearnedSubject>();
      for (const c of wkCheckins) {
        const subj = contentService.getSubject(c.subject_id);
        if (!subj) continue;
        let entry = bySubj.get(c.subject_id);
        if (!entry) {
          entry = { subjectId: c.subject_id, icon: subj.map_icon, subjectName: subj.map_name, color: subj.color, units: [] };
          bySubj.set(c.subject_id, entry);
        }
        const uid = c.actual_unit_id!;
        if (entry.units.some((u) => u.unitId === uid)) continue;
        const u = contentService.getUnit(uid);
        const kns = contentService.getKnowledge(uid);
        entry.units.push({
          unitId: uid,
          unitName: u?.unit_name ?? '已确认的进度',
          knowledge: kns.map((k) => ({ knowledgeId: k.knowledge_id, title: k.title })),
        });
      }
      setLearned([...bySubj.values()]);

      // 最近一次考试
      const exams = await userData.getAssessments(child.id);
      setLastExam(exams[0] ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '看板加载失败');
    } finally {
      setLoading(false);
    }
  }, [child, grade]);

  useEffect(() => {
    if (ready && child) void load();
    else if (ready) setLoading(false);
  }, [ready, child, load]);

  const cur = weekRange();
  const weekActive = weekStats.total > 0 || learned.length > 0 || !!lastExam;
  const empty = !loading && !error && !weekActive && attention.length === 0;

  if (!ready) return <div className="page"><Loading lines={4} /></div>;

  if (!child) {
    return (
      <div className="page">
        <EmptyState
          icon="🧒"
          title="先来认识一下孩子吧"
          desc="创建孩子之后，看板会告诉你 TA 现在怎么样"
          action={<button className="btn btn-primary" onClick={() => navigate('/settings')}>添加孩子</button>}
        />
      </div>
    );
  }

  const showDetail = (id: string) => setDetailId(id);

  return (
    <div className="page">
      <header className="row-between" style={{ marginBottom: 'var(--sp-lg)' }}>
        <div>
          <div className="t-title">📊 家长看板</div>
          <div className="t-meta">
            {grade} · 第 {cur.week_no} 周 · {fmtWeekRange(cur.week_start, cur.week_end)}
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          <SyncBadge state={syncState} />
        </div>
      </header>

      {error ? (
        <EmptyState icon="🌧️" title="看板暂时打不开" desc={error} action={<button className="btn" onClick={() => void load()}>重新加载</button>} />
      ) : loading ? (
        <Loading lines={5} />
      ) : empty ? (
        <EmptyState
          icon="🌱"
          title="这周还没有复盘记录"
          desc="完成本周复盘之后，这里就会告诉你孩子现在怎么样"
          action={<button className="btn btn-primary" onClick={() => navigate('/review')}>去做本周复盘</button>}
        />
      ) : (
        <>
          {/* Hero：本周整体掌握度（基于本周复盘的知识点掌握情况） */}
          <section className={styles.hero}>
            <div className={styles.heroQ}>我的孩子本周状态怎么样？</div>
            {weekStats.total === 0 ? (
              <div className={styles.ringMuted}>本周还没复盘</div>
            ) : (
              <div className={styles.ringWrap}>
                <Ring pct={overall} size={150} color="var(--cta)" label="本周掌握度" />
              </div>
            )}
            <CompareBadge delta={delta} />
            <div className={styles.heroMeta}>
              {weekStats.attention > 0 ? `本周 ${weekStats.attention} 个知识点需关注` : '这周状态挺稳的'}
            </div>
            {weekStats.total > 0 ? (
              <div className={styles.unrev}>本周复盘了 <b>{weekStats.total}</b> 个知识点，{weekStats.stable} 个已掌握</div>
            ) : null}
          </section>

          {/* 本周学了什么（移到需要关注之上，按学科分组，可展开） */}
          <section className="stack-sm" style={{ marginBottom: 'var(--sp-lg)' }}>
            <div className={styles.sectionTitle}>📖 本周学了什么</div>
            {learned.length === 0 ? (
              <div className={`${styles.learnCard} t-meta`}>本周还没确认学习进度，去复盘时勾一下就知道啦</div>
            ) : (
              <div className="stack-sm">
                {learned.map((subj) => {
                  const count = subj.units.reduce((a, u) => a + u.knowledge.length, 0);
                  return (
                    <div key={subj.subjectId} className={styles.learnSubjectCard} style={subj.color ? { borderLeft: `4px solid ${subj.color}` } : undefined}>
                      <button
                        className={styles.learnSubjectHead}
                        onClick={() => {
                          setLearnedSubject(subj.subjectId);
                          setLearnedOpen(true);
                        }}
                      >
                        <SubjectTag subjectId={subj.subjectId} size="sm" />
                        <span className="grow t-meta">{count > 0 ? `${count} 个知识点` : '已确认进度'}</span>
                        <span className={styles.listChev}>›</span>
                      </button>
                      <div className={styles.learnUnits}>
                        {subj.units.map((u) => (
                          <span key={u.unitId} className={styles.learnUnit}>{u.unitName}</span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* 需要关注 */}
          <section className="stack-sm" style={{ marginBottom: 'var(--sp-lg)' }}>
            <div className={styles.sectionTitle}>🔎 需要关注</div>
            {attention.length === 0 ? (
              <div className={styles.emptyGood}>
                <span style={{ fontSize: 22 }}>🎉</span>
                <span>太棒了，这周没有特别需要关注的知识点</span>
              </div>
            ) : (
              attention.map((a) => (
                <button key={a.id} className={styles.attnCard} onClick={() => showDetail(a.id)}>
                  <StatusDot status={a.status} size="lg" />
                  <span className={styles.attnMeta}>
                    <div className={styles.attnName}>{a.title}</div>
                    <div className={styles.attnSub}>
                      {a.subjectId ? <SubjectTag subjectId={a.subjectId} size="sm" /> : null} · {a.unit}
                      {a.count > 1 ? ` · 已复核 ${a.count} 次` : ''}
                    </div>
                  </span>
                  <span className={styles.attnChev}>›</span>
                </button>
              ))
            )}
          </section>

          {/* 最近一次考试（Design Change 05） */}
          <section className="stack-sm" style={{ marginBottom: 'var(--sp-lg)' }}>
            <div className={styles.sectionTitle}>📝 最近一次考试</div>
            <div className={`${styles.examCard} ${styles.clickable}`} onClick={() => setExamOpen(true)}>
              {lastExam ? (
                <div className={styles.examRow}>
                  <div>
                    <div className="t-body">
                      {contentService.getSubject(lastExam.subject_id)?.map_name} · {lastExam.exam_type}
                    </div>
                    <div className="t-meta">{lastExam.semester} · {lastExam.exam_date}</div>
                  </div>
                  <div className={styles.examScore}>{lastExam.score}/{lastExam.full_score}</div>
                </div>
              ) : (
                <div className="t-meta">还没有考试记录，点这里添加第一次 ✍️</div>
              )}
            </div>
          </section>

          <button className="btn-text center" onClick={() => navigate('/timeline')}>
            查看完整成长档案 →
          </button>
        </>
      )}

      {/* 考试：查看 / 新增 */}
      <Sheet open={examOpen} onClose={() => setExamOpen(false)}>
        <ExamSheet childId={child.id} onChanged={() => { setExamOpen(false); void load(); }} />
      </Sheet>

      {/* 需要关注：知识点详情 */}
      <Sheet open={!!detailId} onClose={() => setDetailId(null)}>
        {detailId ? <KnowledgeDetailSheet childId={child.id} knowledgeId={detailId} /> : null}
      </Sheet>

      {/* 本周学了什么：分学科知识点列表 */}
      <Sheet open={learnedOpen} onClose={() => setLearnedOpen(false)}>
        {learnedSubject ? (
          <LearnedListSheet
            subject={learned.find((s) => s.subjectId === learnedSubject)!}
            onClose={() => setLearnedOpen(false)}
            onDetail={(id) => setLearnedDetailId(id)}
          />
        ) : null}
      </Sheet>

      {/* 本周学了什么：知识点详情 */}
      <Sheet open={!!learnedDetailId} onClose={() => setLearnedDetailId(null)}>
        {learnedDetailId ? <KnowledgeDetailSheet childId={child.id} knowledgeId={learnedDetailId} /> : null}
      </Sheet>
    </div>
  );
}

// ---------------------------------------------------------------- 本周学了什么（分学科）

function LearnedListSheet({ subject, onClose, onDetail }: { subject: LearnedSubject; onClose: () => void; onDetail: (id: string) => void }) {
  const total = subject.units.reduce((a, u) => a + u.knowledge.length, 0);
  return (
    <div className="stack">
      <div className="t-sub">
        <SubjectTag subjectId={subject.subjectId} size="sm" /> {subject.subjectName} · 本周学了 {total} 个知识点
      </div>
      {subject.units.length === 0 ? (
        <div className="t-meta">本周还没确认这一科的学习进度</div>
      ) : (
        subject.units.map((u) => (
          <div key={u.unitId} className="stack-sm">
            <div className={styles.learnedUnitTitle}>
              <span>{subject.icon}</span> {u.unitName}
            </div>
            {u.knowledge.length === 0 ? (
              <div className="t-meta">该单元暂无知识点数据</div>
            ) : (
              u.knowledge.map((k) => (
                <button key={k.knowledgeId} className={styles.listItem} onClick={() => onDetail(k.knowledgeId)}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <div className={styles.listTitle}>{k.title}</div>
                    <div className={styles.listMeta}>
                      <SubjectTag subjectId={subject.subjectId} size="sm" /> · {subject.subjectName}
                    </div>
                  </span>
                  <span className={styles.listChev}>›</span>
                </button>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}

function CompareBadge({ delta }: { delta: number }) {
  if (delta > 0) return <div className={`${styles.compare} ${styles.up}`}>↑ 比上周多掌握 {delta} 项</div>;
  if (delta < 0) return <div className={`${styles.compare} ${styles.down}`}>↓ 比上周少掌握 {Math.abs(delta)} 项</div>;
  return <div className={`${styles.compare} ${styles.flat}`}>与上周持平</div>;
}

function ExamSheet({ childId, onChanged }: { childId: string; onChanged: () => void }) {
  const [list, setList] = useState<Assessment[]>([]);
  const [adding, setAdding] = useState(false);
  const [subjectId, setSubjectId] = useState(contentService.getSubjects()[0]?.subject_id ?? '');
  const [examType, setExamType] = useState('期中');
  const [score, setScore] = useState('');
  const [full, setFull] = useState('100');
  const [semester, setSemester] = useState('本学期');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const refresh = useCallback(async () => setList(await userData.getAssessments(childId)), [childId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    const sc = Number(score);
    const fu = Number(full) || 100;
    if (!score || Number.isNaN(sc)) {
      showToast('填写一下分数吧');
      return;
    }
    await userData.createAssessment({
      child_id: childId,
      subject_id: subjectId,
      exam_type: examType,
      exam_date: date,
      score: sc,
      full_score: fu,
      semester,
      note: note.trim(),
    });
    showToast('考试记录已留下 📝');
    setAdding(false);
    setScore('');
    setNote('');
    await refresh();
    onChanged();
  };

  if (adding) {
    return (
      <div className="stack">
        <div className="t-sub">新增考试记录</div>
        <div className="scroll-x">
          {contentService.getSubjects().map((s) => (
            <button key={s.subject_id} className={`pill${subjectId === s.subject_id ? ' on' : ''}`} onClick={() => setSubjectId(s.subject_id)}>
              {s.map_icon} {s.map_name}
            </button>
          ))}
        </div>
        <div className="pillRow">
          {['期中', '期末', '单元测试', '其他'].map((t) => (
            <button key={t} className={`pill${examType === t ? ' on' : ''}`} onClick={() => setExamType(t)}>{t}</button>
          ))}
        </div>
        <div className="formRow">
          <label>得分 / 满分</label>
          <div className={styles.scoreRow}>
            <input className="input" inputMode="numeric" value={score} onChange={(e) => setScore(e.target.value)} placeholder="92" />
            <span className="t-meta" style={{ alignSelf: 'center' }}>/</span>
            <input className="input" inputMode="numeric" value={full} onChange={(e) => setFull(e.target.value)} style={{ maxWidth: 90 }} />
          </div>
        </div>
        <div className={styles.scoreRow}>
          <div className="formRow" style={{ flex: 1 }}>
            <label>学期</label>
            <input className="input" value={semester} onChange={(e) => setSemester(e.target.value)} />
          </div>
          <div className="formRow" style={{ flex: 1 }}>
            <label>日期</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="formRow">
          <label>备注（可选）</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：比上次进步了" />
        </div>
        <button className="btn btn-primary btn-block" onClick={() => void save()}>保存记录</button>
        <button className="btn-text center" onClick={() => setAdding(false)}>取消</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row-between">
        <div className="t-sub">考试记录</div>
        <button className="btn" onClick={() => setAdding(true)}>＋ 新增</button>
      </div>
      {list.length === 0 ? (
        <div className="t-meta">还没有考试记录。考试是成长里程碑，记得来记一笔～</div>
      ) : (
        <div className="stack-sm">
          {list.map((a) => (
            <div key={a.id} className="card row">
              <span style={{ fontSize: 20 }}>📝</span>
              <span className="grow">
                <span className="t-body" style={{ fontSize: 14 }}>{contentService.getSubject(a.subject_id)?.map_name} · {a.exam_type}</span>
                <span className="t-meta" style={{ display: 'block' }}>{a.semester} · {a.exam_date}</span>
              </span>
              <span className={styles.examScore}>{a.score}/{a.full_score}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
