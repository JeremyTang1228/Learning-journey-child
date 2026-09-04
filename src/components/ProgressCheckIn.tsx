/**
 * ProgressCheckIn —— 实际学习进度确认
 * 原型来源：03_UI_Prototype/ProgressCheckIn.html（V1.1 Design Change 01）
 *
 * 这是地图位置的唯一驱动源（V1.1 原则 2/3）：
 *   - 头像位置只由这里的一次显式确认推进
 *   - 绝不用定时计算，绝不用「已掌握知识点 / 总知识点」的百分比
 *
 * school_calendar 目前为 0 行，没有「理论预计进度」可用，
 * 因此走校准报告附录 A 的降级方案：完全由家长手动选择实际学到的单元，
 * 不去编造一个「预计学到哪里」。
 * delta_type 通过与上一次确认的单元对比得出，而不是与课表对比。
 */
import { useEffect, useMemo, useState } from 'react';
import * as userData from '@/services/userDataService';
import { contentService, type HydratedUnit } from '@/services/contentService';
import { showToast } from '@/components/ui';

export interface CheckInResult {
  subject_id: string;
  actual_unit_id: string | null;
  delta_type: 'on_pace' | 'ahead' | 'behind' | 'no_class';
}

interface Props {
  childId: string;
  weekStart: string;
  grade: string;
  subjects: { subject_id: string; map_name: string; map_icon: string; color: string }[];
  onDone: (results: CheckInResult[]) => void;
}

export default function ProgressCheckIn({ childId, weekStart, grade, subjects, onDone }: Props) {
  const [unitPick, setUnitPick] = useState<Record<string, string | null>>({});
  const [noClass, setNoClass] = useState<Record<string, boolean>>({});
  const [prevUnit, setPrevUnit] = useState<Record<string, string | null>>({});
  const [loaded, setLoaded] = useState(false);

  /** 每个学科的单元列表 + 上一次确认到达的位置 */
  const data = useMemo(() => {
    return subjects.map((s) => {
      const units = contentService.getUnitsByGradeSubject(grade, s.subject_id);
      return { ...s, units };
    });
  }, [subjects, grade]);

  // 载入上一次确认结果，用于给出默认选中项与前后各 2 个单元的窗口
  useEffect(() => {
    let alive = true;
    void (async () => {
      const next: Record<string, string | null> = {};
      for (const s of subjects) {
        const last = await userData.getLatestCheckIn(childId, s.subject_id);
        next[s.subject_id] = last?.actual_unit_id ?? null;
      }
      if (alive) {
        setPrevUnit(next);
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [childId, subjects]);

  const resolve = (subjectId: string): CheckInResult => {
    const units = data.find((d) => d.subject_id === subjectId)?.units ?? [];
    if (noClass[subjectId]) return { subject_id: subjectId, actual_unit_id: null, delta_type: 'no_class' };

    const picked = unitPick[subjectId];
    const prevId = prevUnit[subjectId] ?? null;
    const unit = picked ? units.find((u) => u.unit_id === picked) : null;

    // 没做任何选择 → 维持上次位置（不后退，也不制造"落后"提示）
    if (!unit) {
      return { subject_id: subjectId, actual_unit_id: prevId, delta_type: 'on_pace' };
    }
    const prevIdx = prevId ? units.findIndex((u) => u.unit_id === prevId) : -1;
    const idx = units.findIndex((u) => u.unit_id === unit.unit_id);
    let delta: CheckInResult['delta_type'] = 'on_pace';
    if (prevIdx >= 0 && idx > prevIdx) delta = 'ahead';
    else if (prevIdx >= 0 && idx < prevIdx) delta = 'behind';
    return { subject_id: subjectId, actual_unit_id: unit.unit_id, delta_type: delta };
  };

  const submit = async () => {
    const results = subjects.map((s) => resolve(s.subject_id));
    await Promise.all(
      results.map((r) =>
        userData.saveProgressCheckIn({
          child_id: childId,
          week_start: weekStart,
          subject_id: r.subject_id,
          actual_unit_id: r.actual_unit_id,
          delta_type: r.delta_type,
        })
      )
    );
    showToast('好嘞，已经记下来了');
    onDone(results);
  };

  return (
    <div className="stack">
      <div>
        <div className="t-title">📍 这一周，我们走到哪里了？</div>
        <div className="t-meta" style={{ marginTop: 4 }}>
          花 30 秒确认一下，剩下的交给系统
        </div>
      </div>

      {data.map((s) => {
        const prevId = prevUnit[s.subject_id] ?? null;
        const prevIdx = prevId ? s.units.findIndex((u) => u.unit_id === prevId) : -1;
        // 只展示上次位置前后各 2 个单元，不是全量列表（校准报告附录 A）
        const center = prevIdx >= 0 ? prevIdx : 0;
        const window: HydratedUnit[] = s.units.slice(Math.max(0, center - 2), center + 3);
        const currentId = unitPick[s.subject_id] ?? prevId;
        const off = noClass[s.subject_id];

        return (
          <div key={s.subject_id} className="card stack-sm">
            <div className="row" style={{ gap: 6 }}>
              <span style={{ fontSize: 18 }}>{s.map_icon}</span>
              <span className="t-body" style={{ color: s.color, fontWeight: 700 }}>
                {s.map_name}
              </span>
            </div>

            {s.units.length === 0 ? (
              <div className="t-meta">这一年级暂时没有该学科的单元，可以跳过。</div>
            ) : (
              <>
                <div className="t-meta">选一下实际学到哪个单元：</div>
                <div className="scroll-x">
                  {window.map((u) => (
                    <button
                      key={u.unit_id}
                      className={`chip${currentId === u.unit_id ? ' on' : ''}`}
                      disabled={off}
                      onClick={() => setUnitPick((p) => ({ ...p, [s.subject_id]: u.unit_id }))}
                    >
                      {u.unit_name}
                    </button>
                  ))}
                </div>
              </>
            )}

            <button
              className="btn-text"
              style={{ alignSelf: 'flex-start', fontSize: 12 }}
              onClick={() => setNoClass((p) => ({ ...p, [s.subject_id]: !off }))}
            >
              {off ? '✓ 这周没正常上课' : '这周没有正常上课（假期/活动/生病）'}
            </button>
          </div>
        );
      })}

      <div className="t-meta" style={{ lineHeight: 1.6 }}>
        没选也没关系 —— 位置会保持不变，下次再继续。
      </div>

      <button className="btn btn-primary btn-lg btn-block" onClick={() => void submit()}>
        确认
      </button>
    </div>
  );
}
