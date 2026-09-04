// 校验 resource_id 整合结果：按学科统计视频可播放覆盖，确认 sexk 链接合法
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '/Users/jeremy/WorkBuddy/2026-08-31-17-11-25/src/data/content';

const curriculums = JSON.parse(fs.readFileSync(path.join(ROOT, 'curriculums.json'), 'utf8'));
const units = JSON.parse(fs.readFileSync(path.join(ROOT, 'units.json'), 'utf8'));
const knChunks = fs.readdirSync(path.join(ROOT, 'knowledge_nodes'));
const resChunks = fs.readdirSync(path.join(ROOT, 'resources'));

const curById = new Map(curriculums.map((c) => [c.curriculum_id, c]));
const unitById = new Map(units.map((u) => [u.unit_id, u]));
const knById = new Map();
for (const f of knChunks) {
  for (const k of JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge_nodes', f), 'utf8')))
    knById.set(k.knowledge_id, k);
}

const videos = [];
for (const f of resChunks) {
  for (const r of JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', f), 'utf8'))) {
    if (r.resource_type === 'video') videos.push(r);
  }
}

// 按学科统计
const bySubj = new Map();
let sexkCount = 0, seykCount = 0, badUrl = 0, sampleSexk = [], sampleSeyk = [];
for (const r of videos) {
  const k = knById.get(r.knowledge_id);
  const u = k && unitById.get(k.unit_id);
  const c = u && curById.get(u.curriculum_id);
  const subj = c?.subject || '(未知)';
  const g = bySubj.get(subj) || { total: 0, play: 0, cover: 0 };
  g.total++;
  if (r.is_playable && r.play_url) g.play++;
  if (r.cover_url) g.cover++;
  bySubj.set(subj, g);

  if (r.play_url && /sexk\/detail\.php\?resource_id=/.test(r.play_url)) {
    sexkCount++;
    if (!/^https:\/\/basic\.jiangsu\.smartedu\.cn\/cloudCourse\/sexk\/detail\.php\?resource_id=\d+(#player-container-id)?$/.test(r.play_url)) badUrl++;
    if (sampleSexk.length < 3) sampleSexk.push(r.play_url);
  }
  if (r.play_url && /seyk\/detail\.php\?resource_id=/.test(r.play_url)) {
    seykCount++;
    if (!/^https:\/\/basic\.jiangsu\.smartedu\.cn\/cloudCourse\/seyk\/detail\.php\?resource_id=\d+(#player-container-id)?$/.test(r.play_url)) badUrl++;
    if (sampleSeyk.length < 3) sampleSeyk.push(r.play_url);
  }
}

console.log('=== 视频可播放覆盖（按学科）===');
console.log('学科'.padEnd(10), '视频总数', '可播放', '有封面', '未播放');
for (const [s, g] of [...bySubj.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(s.padEnd(10), String(g.total).padStart(6), String(g.play).padStart(6), String(g.cover).padStart(6), String(g.total - g.play).padStart(6));
}
const tot = videos.length;
const totPlay = [...bySubj.values()].reduce((a, g) => a + g.play, 0);
console.log('─'.repeat(40));
console.log('合计'.padEnd(10), String(tot).padStart(6), String(totPlay).padStart(6));

console.log('\n=== 直链格式校验 ===');
console.log('sexk 可播放条数:', sexkCount);
console.log('seyk 可播放条数:', seykCount);
console.log('格式异常条数   :', badUrl);
console.log('sexk 样本:');
sampleSexk.forEach((u) => console.log('  ' + u));
console.log('seyk 样本:');
sampleSeyk.forEach((u) => console.log('  ' + u));

// 数学单独看
const math = bySubj.get('小学数学');
if (math) console.log(`\n小学数学：视频 ${math.total}，可播放 ${math.play}，未播放 ${math.total - math.play}`);
else console.log('\n未找到「小学数学」学科视频');
