import fs from 'node:fs';

const B = 'src/data/content/';
const load = (p) => JSON.parse(fs.readFileSync(B + p, 'utf8'));

// 建 knowledge_id -> grade 映射（resources 不含 grade 字段）
const knGrade = {};
for (const g of ['g1', 'g2', 'g3', 'g4', 'g5', 'g6']) {
  for (const k of load(`knowledge_nodes/${g}.json`)) knGrade[k.knowledge_id] = k.grade;
}

const resChunks = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((g) => load(`resources/${g}.json`)).flat();
const videos = resChunks.filter((r) => r.resource_type === 'video');

let withCover = 0, withPlay = 0, withChapter = 0;
const byModule = {};
const byGrade = {};
for (const v of videos) {
  if (v.cover_url) withCover++;
  if (v.is_playable && v.play_url) withPlay++;
  if (v.chapter_id) withChapter++;
  byModule[v.source_module || '未知'] = (byModule[v.source_module || '未知'] || 0) + 1;
  const g = knGrade[v.knowledge_id] || '?';
  byGrade[g] = byGrade[g] || { total: 0, cover: 0, play: 0 };
  byGrade[g].total++;
  if (v.cover_url) byGrade[g].cover++;
  if (v.is_playable && v.play_url) byGrade[g].play++;
}

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ❌', m); } };

console.log('=== 视频整合校验 ===');
console.log(`视频总数: ${videos.length}`);
console.log(`  有封面图: ${withCover} (${(withCover / videos.length * 100).toFixed(1)}%)`);
console.log(`  可播放(带 play_url): ${withPlay} (${(withPlay / videos.length * 100).toFixed(1)}%)`);
console.log(`  带 chapter_id: ${withChapter}`);
console.log('  按来源模块:', JSON.stringify(byModule));
console.log('  按年级:');
for (const [g, o] of Object.entries(byGrade).sort())
  console.log(`    ${g}: 总${o.total} 封面${o.cover} 可播放${o.play}`);

ok(videos.length === 1794, `视频总数应为 1794，实际 ${videos.length}`);
ok(withCover >= 1700, `有封面图应 ≥1700，实际 ${withCover}`);
ok(withPlay >= 700, `可播放应 ≥700，实际 ${withPlay}`);
const badPlay = videos.filter((v) => v.is_playable && !/^https?:\/\//.test(v.play_url || ''));
ok(badPlay.length === 0, `可播放资源 play_url 必须合法，异常 ${badPlay.length}`);
const badCh = videos.filter((v) => v.chapter_id && !/^\d+$/.test(String(v.chapter_id)));
ok(badCh.length === 0, `chapter_id 必须为数字，异常 ${badCh.length}`);
const playNoCover = videos.filter((v) => v.is_playable && !v.cover_url);
ok(playNoCover.length === 0, `可播放资源应都有封面，异常 ${playNoCover.length}`);

// 跨模块抽样封面可达性
const want = [];
const add = (m, n) => { const xs = videos.filter((v) => (v.source_module || '未知') === m && v.cover_url); want.push(...xs.slice(0, n)); };
add('苏e优课', 3); add('苏e新课', 2); add('未知', 1);
console.log(`\n封面可达性抽样(${want.length}，跨模块):`);
await Promise.all(want.map(async (v) => {
  try {
    const r = await fetch(v.cover_url, { method: 'GET' });
    const ct = r.headers.get('content-type') || '';
    const good = r.status === 200 && ct.startsWith('image');
    console.log(`  ${good ? '✅' : '❌'} ${r.status} ${ct}  ${v.cover_url.slice(0, 52)}...`);
    good ? pass++ : fail++;
  } catch (e) {
    console.log(`  ❌ ERR ${e.message} ${v.cover_url.slice(0, 48)}`); fail++;
  }
}));

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
