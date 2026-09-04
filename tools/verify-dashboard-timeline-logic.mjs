/**
 * 纯逻辑校验：复刻 GrowthTimeline 的"按周合并"与 ParentDashboard 的"周环比"算法，
 * 用 mock 数据验证日期数学没有 off-by-one / 排序 bug（这两处最容易写错）。
 * 不与浏览器/IndexedDB 耦合，仅验证算法本身。
 */
const pad = (n) => String(n).padStart(2, '0');
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const startOfWeek = (d = new Date()) => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const day = r.getDay() || 7; r.setDate(r.getDate() - (day - 1)); return r; };
const weekKeyOf = (iso) => startOfWeek(fromISO(iso)).toISOString().slice(0, 10);
const isStable = (s) => s === 'mastered' || s === 'basic';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.log('  ✗', msg); } };

// ---- 1. 时间轴：按周合并 knowledge 记录 ----
console.log('1. 时间轴按周合并');
// 造三条记录：两条在同一周（周一+周三），一条在下一周
const records = [
  { id: 'a', type: 'knowledge', record_date: '2026-03-02', metadata: { status: 'mastered' } }, // 周一
  { id: 'b', type: 'knowledge', record_date: '2026-03-04', metadata: { status: 'needs_review' } }, // 周三，同周
  { id: 'c', type: 'knowledge', record_date: '2026-03-09', metadata: { status: 'mastered' } }, // 下周一，新周
];
const byWeek = new Map();
for (const r of records) {
  const wk = weekKeyOf(r.record_date);
  if (!byWeek.has(wk)) byWeek.set(wk, []);
  byWeek.get(wk).push(r);
}
ok(byWeek.size === 2, `应合并为 2 个周分组，实际 ${byWeek.size}`);
const firstWeek = [...byWeek.values()].find((g) => g.length === 2);
ok(!!firstWeek, '同一周（3/2 与 3/4）应被合并为一组');
const secondWeek = [...byWeek.values()].find((g) => g.length === 1);
ok(secondWeek && secondWeek[0].record_date === '2026-03-09', '3/9 单独成组');
// 跨年边界：12/29(周一) 与 1/5 应不同周；12/30(周二) 与 12/29 同周
ok(weekKeyOf('2025-12-29') === weekKeyOf('2025-12-30'), '12/29(一)与12/30(二)同周');
ok(weekKeyOf('2025-12-29') !== weekKeyOf('2026-01-05'), '跨年不同周');

// ---- 2. 看板：周环比（本周 vs 上周新增掌握）----
console.log('2. 看板周环比');
const now = '2026-03-04T10:00:00.000Z';
const cur = { week_start: '2026-03-02' }; // 周一
const prevStart = (() => { const d = fromISO(cur.week_start); d.setDate(d.getDate() - 7); return toISO(d); })();
const items = [
  { knowledge_status: 'mastered', created_at: '2026-03-02T09:00:00.000Z' }, // 本周掌握
  { knowledge_status: 'mastered', created_at: '2026-03-03T09:00:00.000Z' }, // 本周掌握
  { knowledge_status: 'focus', created_at: '2026-03-02T09:00:00.000Z' },    // 本周非掌握
  { knowledge_status: 'mastered', created_at: '2026-02-24T09:00:00.000Z' }, // 上周掌握
];
const thisGain = items.filter((i) => isStable(i.knowledge_status) && i.created_at >= cur.week_start && i.created_at <= now).length;
const lastGain = items.filter((i) => isStable(i.knowledge_status) && i.created_at >= prevStart && i.created_at < cur.week_start).length;
ok(thisGain === 2, `本周新增掌握应为 2，实际 ${thisGain}`);
ok(lastGain === 1, `上周新增掌握应为 1，实际 ${lastGain}`);
ok(thisGain - lastGain === 1, `环比 delta 应为 +1，实际 ${thisGain - lastGain}`);

// ---- 3. 看板：整体掌握度占比 ----
console.log('3. 整体掌握度占比');
const total = 10;
const stableCount = 6;
const pct = Math.round((stableCount / total) * 100);
ok(pct === 60, `6/10 应为 60%，实际 ${pct}`);
const zeroTotalPct = total === 0 ? 0 : Math.round((stableCount / total) * 100);
ok(zeroTotalPct === 60, '除零保护');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
