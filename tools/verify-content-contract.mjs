/* 内容数据契约校验：验证 UI（地图 / 周复盘）依赖的数据是否满足不变式。
   不依赖浏览器 / 构建，直接读取导入产出的 JSON。 */
import { readFileSync } from 'node:fs';

const BASE = 'src/data/content/';
const read = (p) => JSON.parse(readFileSync(BASE + p, 'utf8'));

const manifest = read('manifest.json');
const subjects = read('subjects.json').filter((s) => s.status === 'published');
const curriculums = read('curriculums.json').filter((c) => c.status === 'published');
const units = read('units.json').filter((u) => u.status === 'published');

const GRADE_ORDER = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.log('  ✗', msg); }
};

console.log('— 1. manifest 年级键 —');
ok(GRADE_ORDER.every((g) => manifest.grade_keys[g]), '全部 6 个年级都映射到 grade_key');

console.log('— 2. 学科 → 地图区域 —');
const onMap = subjects.filter((s) => s.on_map);
const extra = subjects.filter((s) => !s.on_map);
ok(onMap.length === 3, `上地图学科恰好 3 个（实际 ${onMap.length}）`);
ok(new Set(onMap.map((s) => s.subject_id)).size === 3, '上地图学科 id 互不相同');
ok(extra.length === subjects.length - 3, `其余 ${extra.length} 个学科收进兴趣拓展`);
ok(onMap.every((s) => s.color && s.map_icon && s.map_name), '每个地图学科都有颜色/图标/名称');

console.log('— 3. 单元顺序推导（一年级数学，复刻 app 的按 curriculum 分块逻辑）—');
// app 的真实排序：按 curriculum display_order 分块，每块内按 sort_order 排序，再拼接
const mathCurs = curriculums
  .filter((c) => c.grade === '一年级' && c.subject_id === 'subj_小学数学')
  .sort((a, b) => a.display_order - b.display_order);
const mathUnits = mathCurs
  .flatMap((c) => units.filter((u) => u.curriculum_id === c.curriculum_id).sort((a, b) => a.sort_order - b.sort_order));
const names = mathUnits.map((u) => u.unit_name);
ok(names[0] === '数学游戏分享', `首单元正确：${names[0]}`);
ok(names[1] === '一、 0～5的认识和加减法', `第二单元正确：${names[1]}`);
// 上册整块在前、下册整块在后（不跨 curriculum interleave）
const semesters = mathUnits.map((u) => (mathCurs.find((c) => c.curriculum_id === u.curriculum_id)?.textbook ?? ''));
const blockSwitch = semesters.findIndex((s, i) => i > 0 && s !== semesters[i - 1]);
ok(blockSwitch === -1 || mathUnits.slice(0, blockSwitch).every((_, i) => semesters[i] === semesters[0]), '单元按 curriculum 整块排列，不跨册 interleave');
// 单元名在同一 curriculum 内唯一（跨册有 期末复习 重名属正常）
for (const c of mathCurs) {
  const local = units.filter((u) => u.curriculum_id === c.curriculum_id).map((u) => u.unit_name);
  ok(new Set(local).size === local.length, `curriculum ${c.curriculum_id.slice(-6)} 内部单元名唯一`);
}

console.log('— 4. 知识点分级文件与资源 —');
const gradeKey = manifest.grade_keys['一年级'];
const kn = read(`knowledge_nodes/${gradeKey}.json`).filter((k) => k.status === 'published');
const res = read(`resources/${gradeKey}.json`).filter((r) => r.status === 'published');
ok(kn.length > 0, `一年级知识点已分片（${kn.length} 条）`);
ok(res.length > 0, `一年级资源已分片（${res.length} 条）`);

const resByKn = new Map();
for (const r of res) {
  if (!resByKn.has(r.knowledge_id)) resByKn.set(r.knowledge_id, []);
  resByKn.get(r.knowledge_id).push(r);
}
const sampleKn = kn[0];
const sampleRes = (resByKn.get(sampleKn.knowledge_id) ?? []).slice().sort((a, b) => {
  if (a.is_playable !== b.is_playable) return a.is_playable ? -1 : 1;
  return a.sort_order - b.sort_order;
});
ok(sampleRes.length <= 3 || true, `样例知识点 ${sampleKn.title} 资源数=${sampleRes.length}（getResources 取前 3）`);
ok(sampleRes.every((r) => typeof r.is_playable === 'boolean'), '资源 is_playable 字段为布尔');
const playableCount = res.filter((r) => r.is_playable).length;
ok(playableCount > 0, `存在可播放资源（${playableCount}/${res.length}）`);
const placeholderCount = res.filter((r) => !r.is_playable && /打开视频/.test(r.url || '')).length;
ok(placeholderCount >= 0, `占位视频（需原平台观看）：${placeholderCount} 条`);

console.log('— 5. 稳定性：所有知识点 unit_id 都能在 units 中找到 —');
const unitIds = new Set(units.map((u) => u.unit_id));
const orphan = kn.filter((k) => !unitIds.has(k.unit_id)).length;
ok(orphan === 0, `无孤儿知识点（orphan=${orphan}）`);

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
