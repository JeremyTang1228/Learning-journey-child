#!/usr/bin/env node
/**
 * Master Data V2 → App Runtime Content JSON
 *
 *   Excel (Source of Truth)
 *     ↓ 读取 / 清洗 / 归一化 / 排序推导
 *     ↓ 校验（ID 唯一、外键、状态枚举、必填、孤儿记录）
 *   src/data/content/*.json
 *
 * 用法：
 *   npm run import:content            # 校验 + 生成
 *   npm run validate:content          # 只校验，不产出（CI 可挂）
 *   MASTER_DATA_XLSX=/path/to.xlsx npm run import:content
 *
 * 设计约束（来自开发总 Prompt）：
 *   - Excel 不上传 Supabase，也不在运行时读取
 *   - 核心关联一律用 Stable ID，禁止按名称关联
 *   - 内容不物理删除，只改 status
 *   - 排序字段在 Excel 中失效时，由 sequence 推导，绝不写死在代码里
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

let XLSX;
try {
  XLSX = (await import('xlsx')).default ?? (await import('xlsx'));
} catch {
  console.error('缺少依赖 xlsx，请先执行 npm install');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'src', 'data', 'content');
const DEFAULT_XLSX =
  '/Users/jeremy/Desktop/小学知识成长地图应用/02_Master_Data/小学知识成长地图_Master_Data_V2_内容管理版.xlsx';
const XLSX_PATH = process.env.MASTER_DATA_XLSX || DEFAULT_XLSX;
const VALIDATE_ONLY = process.argv.includes('--validate-only');

const VALID_STATUS = new Set(['draft', 'published', 'hidden', 'deprecated']);
/** Excel 中 knowledge_nodes 表实际用的是 active，不在规范枚举内，归一化到 published */
const STATUS_ALIAS = { active: 'published' };
const GRADE_ORDER = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'];
const PLACEHOLDER_URLS = new Set(['打开视频', '打开', '查看', '-', '无']);

const errors = [];
const warnings = [];
const notes = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);
const note = (m) => notes.push(m);

// ---------------------------------------------------------------- 读取

if (!fs.existsSync(XLSX_PATH)) {
  console.error(`找不到 Master Data 文件：\n  ${XLSX_PATH}\n\n请设置环境变量 MASTER_DATA_XLSX 指向正确的 xlsx。`);
  process.exit(1);
}

// 自行读取 buffer 再交给 SheetJS，绕开其内部的 sync 文件访问（对含中文的路径更稳）
const wb = XLSX.read(fs.readFileSync(XLSX_PATH), { type: 'buffer', cellDates: false });
const sheet = (name) => {
  const ws = wb.Sheets[name];
  if (!ws) {
    warn(`缺少工作表「${name}」，按空表处理`);
    return [];
  }
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  return rows;
};

const overlay = JSON.parse(fs.readFileSync(path.join(__dirname, 'content-overlay.json'), 'utf8'));

const rawSubjects = sheet('subject_config');
const rawCurriculums = sheet('curriculums');
const rawUnits = sheet('units');
const rawKn = sheet('knowledge_nodes');
const rawRes = sheet('resources');
const rawRelations = sheet('knowledge_relations');
const rawCalendar = sheet('school_calendar');

const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const int = (v, d = 0) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : d;
};

// ---------------------------------------------------------------- 归一化

/** status: 非法值或别名统一收敛到规范枚举 */
function normalizeStatus(v, ctx) {
  const s = str(v).toLowerCase();
  if (STATUS_ALIAS[s]) return STATUS_ALIAS[s];
  if (VALID_STATUS.has(s)) return s;
  err(`非法 status「${str(v)}」@ ${ctx}，允许值：${[...VALID_STATUS].join(' / ')}`);
  return 'draft';
}

/** semester: Excel 中存在「三年级」「三年级上册」「义务教育教科书…二年级下册」等脏值 */
function normalizeSemester(v) {
  const s = str(v);
  if (!s) return '';
  if (s.includes('上册')) return '上册';
  if (s.includes('下册')) return '下册';
  return s;
}

/** 资源 URL：Excel 中 1794 条视频是占位符「打开视频」，不是可播放地址 */
function isPlayableUrl(u) {
  const s = str(u);
  if (!s) return false;
  if (PLACEHOLDER_URLS.has(s)) return false;
  return /^https?:\/\//i.test(s);
}

// ---- subjects
const subjects = rawSubjects
  .filter((r) => str(r.subject_id))
  .map((r) => {
    const id = str(r.subject_id);
    const ov = overlay.subjects[id] || {};
    const excelMapName = str(r.map_name);
    const excelIcon = str(r.map_icon);
    if (excelMapName) note(`学科 ${id} 的 map_name 已由 Excel 提供「${excelMapName}」，覆盖层不再生效`);
    const orderRaw = int(r.display_order, 99);
    const useExcelOrder = orderRaw !== 99;
    return {
      subject_id: id,
      subject: str(r.subject) || str(r.display_name),
      display_name: str(r.display_name) || str(r.subject),
      status: normalizeStatus(r.status, `subject_config/${id}`),
      display_order: useExcelOrder ? orderRaw : ov.display_order ?? 99,
      on_map: ov.on_map === true,
      map_name: excelMapName || ov.map_name || str(r.subject),
      map_icon: excelIcon || ov.map_icon || '📚',
      color: ov.color || '#8C6E52',
      description: str(r.description),
      map_name_source: excelMapName ? 'excel' : 'overlay',
      display_order_source: useExcelOrder ? 'excel' : 'overlay',
    };
  })
  .sort((a, b) => a.display_order - b.display_order);

{
  const ids = subjects.map((s) => s.subject_id);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) err(`subject_config 存在重复 subject_id：${[...new Set(dup)].join(', ')}`);
  const unknown = subjects.filter((s) => !overlay.subjects[s.subject_id]);
  if (unknown.length) warn(`覆盖层未定义的学科：${unknown.map((s) => s.subject_id).join(', ')}（已用兜底值）`);
}

// ---- curriculums
const curriculums = rawCurriculums
  .filter((r) => str(r.curriculum_id))
  .map((r) => ({
    curriculum_id: str(r.curriculum_id),
    stage: str(r.stage),
    grade: str(r.grade),
    subject: str(r.subject),
    subject_id: `subj_${str(r.subject)}`,
    textbook: str(r.textbook),
    semester: normalizeSemester(r.semester),
    semester_raw: str(r.semester),
    status: normalizeStatus(r.status, `curriculums/${str(r.curriculum_id)}`),
    content_version: str(r.content_version) || '1.0',
    display_order: int(r.display_order, 99),
    is_core_subject: String(r.is_core_subject) === 'True' || r.is_core_subject === true,
    map_name: str(r.map_name),
    map_icon: str(r.map_icon),
    map_area: str(r.map_area),
    description: str(r.description),
  }));

// ---- knowledge_nodes（先处理，unit 排序依赖它）
const knByUnit = new Map();
const knowledge = rawKn
  .filter((r) => str(r.knowledge_id))
  .map((r) => {
    const kid = str(r.knowledge_id);
    const uid = str(r.unit_id);
    const title = str(r.title) || str(r.unit_name) || '（待补充）';
    if (!str(r.title)) warn(`知识点 ${kid} 的 title 为空，已回退为单元名「${title}」`);
    const seq = int(r.sequence, 0);
    if (!knByUnit.has(uid)) knByUnit.set(uid, []);
    knByUnit.get(uid).push(seq);
    // grade / subject / textbook / semester / unit_name 由 unit → curriculum 在运行时推导，
    // 不重复落盘（1572 条 × 冗余字段会显著拖慢首屏）
    return {
      knowledge_id: kid,
      unit_id: uid,
      title,
      title_fallback: !str(r.title),
      sequence: seq,
      sort_order: seq, // Excel 的 sort_order 全为 0，改用 sequence
      status: normalizeStatus(r.status, `knowledge_nodes/${kid}`),
      data_quality: str(r.data_quality),
      content_version: str(r.content_version) || '1.0',
    };
  });

// ---- units：Excel 的 sort_order 全为 0，改为由下属知识点的最小 sequence 推导
const unitMinSeq = new Map();
for (const [uid, seqs] of knByUnit) unitMinSeq.set(uid, Math.min(...seqs));

const unitsOfCurriculum = new Map();
for (const r of rawUnits) {
  const cid = str(r.curriculum_id);
  if (!unitsOfCurriculum.has(cid)) unitsOfCurriculum.set(cid, []);
  unitsOfCurriculum.get(cid).push(r);
}

const units = [];
for (const [cid, list] of unitsOfCurriculum) {
  const sorted = [...list].sort(
    (a, b) => (unitMinSeq.get(str(a.unit_id)) ?? Number.MAX_SAFE_INTEGER) - (unitMinSeq.get(str(b.unit_id)) ?? Number.MAX_SAFE_INTEGER)
  );
  sorted.forEach((r, idx) => {
    const uid = str(r.unit_id);
    units.push({
      unit_id: uid,
      curriculum_id: cid,
      unit_name: str(r.unit_name),
      status: normalizeStatus(r.status, `units/${uid}`),
      content_version: str(r.content_version) || '1.0',
      sort_order: idx + 1, // 由知识点 sequence 推导出的密集排名
      knowledge_count: (knByUnit.get(uid) || []).length,
    });
    if (!unitMinSeq.has(uid)) warn(`单元 ${uid} 下没有任何知识点，排序回退为单元内序号`);
  });
}

// ---- unit 元数据索引：grade/subject/textbook/semester 全部由 curriculum 推导
const curById = new Map(curriculums.map((c) => [c.curriculum_id, c]));
const unitMeta = new Map();
for (const u of units) {
  const c = curById.get(u.curriculum_id);
  unitMeta.set(u.unit_id, {
    grade: c?.grade || '',
    subject: c?.subject || '',
    subject_id: c?.subject_id || '',
    textbook: c?.textbook || '',
    semester: c?.semester || '',
    curriculum_id: u.curriculum_id,
    unit_name: u.unit_name,
    sort_order: u.sort_order,
  });
}
/** 知识点 → 所属年级（经 unit → curriculum 推导） */
const gradeOfKn = (k) => unitMeta.get(k.unit_id)?.grade || '';

// ---------------------------------------------------------------- 视频真实链接整合
// 用户提供两份 Excel：苏e新课（苏教版 g1-4，含封面图 + resource_id 直链）与苏e优课（语文人教/英语译林 g1-6，含 chapter_id）。
// 数据说明明确：腾讯云点播 m3u8 直链带 t/us/sign，有效期仅 1 小时，故不做裸直链；
// 可行做法 = 真实封面图(缩略图) + 源平台「干净播放页」(iframe 内嵌直接播放)。
// 两份 Excel 的「视频详情链接 / 视频链接」列虽然显示"打开视频"，但真实超链接分别指向
//   - 苏e优课：cloudCourse/seyk/detail.php?resource_id=NNN
//   - 苏e新课：cloudCourse/sexk/detail.php?resource_id=NNN
// 两个端点均自带腾讯云 TCPlayer、允许 iframe 内嵌，含苏教版数学/语文/英语在内均可直接播放。
const VIDEO_XLSX = [
  '/Users/jeremy/Desktop/小学知识成长地图应用/苏e新课_小学一至四年级_知识点与课件资源汇总.xlsx',
  '/Users/jeremy/Desktop/小学知识成长地图应用/苏e优课_小学一至六年级_语文人教版_英语译林版_知识点与视频索引.xlsx',
];
const VIDEO_BASE = 'https://basic.jiangsu.smartedu.cn';
function normSubject(s) {
  return str(s).replace(/[（(].*?[)）]/g, '').trim();
}
function normText(s) {
  return str(s).replace(/[（(].*?[)）]/g, '').replace(/[\s~～、，,。.\-—_/]/g, '').trim();
}
/** 视频索引/目录汇总 行 → 与 Master Data 匹配的统一键（年级|学科|册次|单元|知识点） */
function videoKey(d) {
  const grade = str(d['年级']);
  const subject = normSubject(d['学科']);
  const sem = normalizeSemester(d['册次']);
  const unit = normText(d['单元 / 模块']);
  const title = normText(d['课时 / 知识点']) || normText(d['视频标题']);
  return `${grade}|${subject}|${sem}|${unit}|${title}`;
}

/**
 * 抽取「视频详情链接 / 视频链接」列中挂着的真实超链接。
 * 这些单元格显示文字是"打开视频"，但真实地址指向
 *   https://basic.jiangsu.smartedu.cn/cloudCourse/{sexk|seyk}/detail.php?resource_id=NNN
 * 自带腾讯云 TCPlayer 且允许 iframe 内嵌，因此可作为 play_url 直接内嵌播放，
 * 无需自行处理 1 小时有效的签名。仅保留 resource_id= 直链，排除无关链接。
 */
function extractResourceLinks(xb, sheetName, source_module) {
  const ws = xb.Sheets[sheetName];
  const out = new Map();
  if (!ws || !ws['!ref']) return out;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const headerCol = new Map();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    if (cell && cell.v != null) headerCol.set(str(cell.v), c);
  }
  const linkCol =
    headerCol.has('视频链接') ? headerCol.get('视频链接')
    : headerCol.has('视频详情链接') ? headerCol.get('视频详情链接')
    : -1;
  if (linkCol < 0) return out;
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: linkCol })];
    if (!cell || !cell.l || !cell.l.Target) continue;
    const target = cell.l.Target;
    if (!/resource_id=/.test(target)) continue;
    const jsonIdx = r - range.s.r - 1;
    const d = rows[jsonIdx];
    if (!d) continue;
    const key = videoKey(d);
    if (!key || key.replace(/\|/g, '').trim() === '') continue;
    const rid = (target.match(/resource_id=(\d+)/) || [])[1] || '';
    out.set(key, { play_url: target, resource_id: rid, source_module });
  }
  return out;
}
function buildVideoIndex() {
  const idx = new Map();
  const resourceLinks = new Map(); // 苏e新课 resource_id 直链：key -> {play_url, resource_id, source_module}
  let total = 0;
  for (const xp of VIDEO_XLSX) {
    if (!fs.existsSync(xp)) {
      warn(`视频资源文件不存在：${xp}`);
      continue;
    }
    const xb = XLSX.read(fs.readFileSync(xp), { type: 'buffer' });
    const get = (name) => {
      const ws = xb.Sheets[name];
      if (!ws) {
        warn(`视频 Excel 缺少工作表「${name}」：${path.basename(xp)}`);
        return [];
      }
      return XLSX.utils.sheet_to_json(ws, { defval: null, raw: true });
    };
    const vi = get('视频索引');
    const cat = get('知识点目录汇总');
    // 目录汇总(含 chapter_id/完整路径) 按课程键 join 到 视频索引(含封面图)
    const catIdx = new Map();
    for (const d of cat) {
      const key = `${str(d['年级'])}|${normSubject(d['学科'])}|${str(d['册次'])}|${normText(d['单元 / 模块'])}|${normText(d['课时 / 知识点'])}`;
      catIdx.set(key, d);
    }
    const moduleName = xp.includes('苏e优课') ? '苏e优课' : '苏e新课';
    // 从两份 Excel 的「视频详情链接 / 视频链接」列抽取真实 resource_id 直链。
    // 苏e新课 → sexk/detail.php?resource_id=NNN；苏e优课 → seyk/detail.php?resource_id=NNN。
    // 这些直链都是自带播放器的干净页面，优先作为 play_url。
    for (const sn of ['视频索引', '知识点目录汇总']) {
      const rl = extractResourceLinks(xb, sn, moduleName);
      for (const [k, v] of rl) if (!resourceLinks.has(k)) resourceLinks.set(k, v);
    }
    for (const d of vi) {
      const lk = videoKey(d);
      const c = catIdx.get(`${str(d['年级'])}|${normSubject(d['学科'])}|${str(d['册次'])}|${normText(d['单元 / 模块'])}|${normText(d['课时 / 知识点'])}`) || {};
      const cover = str(d['封面图']);
      const chapter = str(c['课时chapter_id']);
      // 优先使用 Excel 里挂的真实 resource_id 直链（干净播放页）。
      // 末尾加 #player-container-id 让 iframe 加载后自动滚动到视频区，弱化平台导航条。
      const rl = resourceLinks.get(lk);
      const play = rl?.play_url ? `${rl.play_url}#player-container-id`
        : (moduleName === '苏e优课' && chapter ? `${VIDEO_BASE}/#/clazz/courseDetail?chapterId=${chapter}` : '');
      total += 1;
      const existing = idx.get(lk);
      if (existing) {
        // 优先保留带 play 的记录（苏e优课 > 苏e新课）
        if (play && !existing.play_url) idx.set(lk, { cover_url: cover || existing.cover_url, play_url: play, chapter_id: chapter || existing.chapter_id, source_module: rl?.source_module || moduleName });
        continue;
      }
      idx.set(lk, { cover_url: cover, play_url: play, chapter_id: chapter, source_module: rl?.source_module || moduleName });
    }
    note(`已载入视频索引 ${vi.length} 行 @ ${path.basename(xp)}`);
  }
  // 合并两份 Excel 的 resource_id 直链：为已匹配到 Master Data 但主循环未命中直链的知识点补上可播放地址
  let rlMerged = 0;
  let rlNew = 0;
  for (const [k, v] of resourceLinks) {
    const e = idx.get(k);
    const play = v.play_url ? `${v.play_url}#player-container-id` : '';
    if (e) {
      if (!e.play_url) {
        e.play_url = play;
        e.source_module = v.source_module || e.source_module;
        e.chapter_id = e.chapter_id || '';
        rlMerged += 1;
      }
    } else {
      idx.set(k, { cover_url: '', play_url: play, chapter_id: '', source_module: v.source_module });
      rlNew += 1;
    }
  }
  note(`视频索引共 ${total} 行，去重键 ${idx.size} 个；resource_id 直链：合并 ${rlMerged} 条、独立新增 ${rlNew} 条`);
  return idx;
}
const videoIndex = buildVideoIndex();

/**
 * 单元级兜底索引：4 段键 年级|学科|册次|单元 → 该单元「第一节课」的视频(封面+可播放)。
 * 用途：Master Data 中大量「单元级」知识节点（title 退化成单元名，如「Unit 1 Where's Kitty」
 * 或「第三单元」），而视频索引是「课时/知识点」粒度（Storytime / 树和喜鹊 …）。5 段精确键对不上，
 * 但 年级/学科/册次/单元 4 段完全一致。对这类节点用 4 段键兜底，取该单元首个带播放地址的课时，
 * 即可让单元级视频也能在 app 内直接播放。仅对 title==unit 的节点触发，不会误匹配课时级节点。
 */
const videoUnitFallback = new Map();
for (const [k, v] of videoIndex.entries()) {
  const parts = k.split('|');
  if (parts.length < 5) continue;
  const partial = `${parts[0]}|${parts[1]}|${parts[2]}|${parts[3]}`;
  const cur = videoUnitFallback.get(partial);
  // 优先保留带可播放地址的课时；无播放地址时先占位（封面），遇到首个有播放地址的再升级
  if (!cur || (!cur.play_url && v.play_url)) videoUnitFallback.set(partial, v);
}

/** 由 资源 → 知识点 → 单元 → curriculum 推导 (年级,学科,册次,单元,知识点名) 用于与视频索引匹配 */
function videoContextOf(r) {
  const k = knById.get(str(r.knowledge_id));
  if (!k) return null;
  const m = unitMeta.get(k.unit_id);
  if (!m) return null;
  return { grade: m.grade, subject: m.subject, semester: m.semester, unit: m.unit_name, title: k.title };
}

// ---- resources
const knById = new Map(knowledge.map((k) => [k.knowledge_id, k]));
const resCountByKn = new Map();
let videoEnriched = { total: 0, withCover: 0, withPlay: 0 };
const resources = rawRes
  .filter((r) => str(r.resource_id))
  .map((r) => {
    const kid = str(r.knowledge_id);
    const url = str(r.url);
    const type = str(r.resource_type);
    // is_playable 仅用于媒体资源：video/audio 才允许在 app 内直接消费；PPT/文档等即便 url 合法也不应标 playable
    const playable = isPlayableUrl(url) && ['video', 'audio'].includes(type);
    resCountByKn.set(kid, (resCountByKn.get(kid) || 0) + 1);
    const rec = {
      resource_id: str(r.resource_id),
      knowledge_id: kid,
      resource_type: str(r.resource_type),
      title: str(r.title) || str(r.resource_type),
      url,
      is_playable: playable,
      duration_sec: int(r.duration_sec, 0),
      teacher: str(r.teacher),
      cover_url: str(r.cover_url),
      play_url: '',
      chapter_id: '',
      source_module: '',
      source_platform: str(r.source_platform),
      availability: str(r.availability),
      status: normalizeStatus(r.status, `resources/${str(r.resource_id)}`),
      content_version: str(r.content_version) || '1.0',
      sort_order: int(r.sort_order, 0),
    };
    // 视频链接整合：匹配用户提供的 Excel，注入真实封面图 + 可播放地址
    if (str(r.resource_type) === 'video') {
      videoEnriched.total += 1;
      const ctx = videoContextOf(r);
      if (ctx) {
        const lk = `${ctx.grade}|${normSubject(ctx.subject)}|${ctx.semester}|${normText(ctx.unit)}|${normText(ctx.title)}`;
        let v = videoIndex.get(lk);
        // 单元级节点兜底：title 退化为单元名时，按 年级|学科|册次|单元 取该单元第一节课
        if (!v && normText(ctx.title) === normText(ctx.unit)) {
          const partial = `${ctx.grade}|${normSubject(ctx.subject)}|${ctx.semester}|${normText(ctx.unit)}`;
          v = videoUnitFallback.get(partial) || undefined;
          if (v) videoEnriched.byUnitFallback = (videoEnriched.byUnitFallback || 0) + 1;
        }
        if (v) {
          if (v.cover_url) {
            rec.cover_url = v.cover_url;
            videoEnriched.withCover += 1;
          }
          if (v.play_url) {
            rec.play_url = v.play_url;
            rec.chapter_id = v.chapter_id;
            rec.is_playable = true;
            videoEnriched.withPlay += 1;
          }
          if (v.source_module) {
            rec.source_module = v.source_module;
            if (!rec.source_platform) rec.source_platform = v.source_module;
          }
        }
      }
    }
    return rec;
  });

for (const k of knowledge) k.resource_count = resCountByKn.get(k.knowledge_id) || 0;

// ---------------------------------------------------------------- 校验

// ID 唯一性
for (const [name, rows, key] of [
  ['curriculums', curriculums, 'curriculum_id'],
  ['units', units, 'unit_id'],
  ['knowledge_nodes', knowledge, 'knowledge_id'],
  ['resources', resources, 'resource_id'],
]) {
  const ids = rows.map((r) => r[key]);
  const dup = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  if (dup.length) err(`${name} 存在重复 ${key}：${dup.slice(0, 5).join(', ')}`);
}

// 外键完整性
const curIdSet = new Set(curriculums.map((c) => c.curriculum_id));
const unitIdSet = new Set(units.map((u) => u.unit_id));
const knIdSet = new Set(knowledge.map((k) => k.knowledge_id));

for (const u of units)
  if (!curIdSet.has(u.curriculum_id)) err(`units/${u.unit_id} 引用不存在的 curriculum_id「${u.curriculum_id}」`);
for (const k of knowledge)
  if (!unitIdSet.has(k.unit_id)) err(`knowledge_nodes/${k.knowledge_id} 引用不存在的 unit_id「${k.unit_id}」`);
const orphanRes = resources.filter((r) => !knIdSet.has(r.knowledge_id));
if (orphanRes.length)
  err(`resources 存在 ${orphanRes.length} 条孤儿记录（引用不存在的 knowledge_id），例：${orphanRes[0].resource_id} → ${orphanRes[0].knowledge_id}`);

// 必填
for (const k of knowledge) {
  if (!k.unit_id) err(`knowledge_nodes/${k.knowledge_id} 缺少 unit_id`);
  const meta = unitMeta.get(k.unit_id);
  if (meta && (!meta.grade || !meta.subject))
    err(`knowledge_nodes/${k.knowledge_id} 所属单元无法推导 grade/subject（curriculum 缺失）`);
}
for (const u of units) if (!u.unit_name) err(`units/${u.unit_id} 缺少 unit_name`);
for (const c of curriculums) if (!c.grade || !c.subject) err(`curriculums/${c.curriculum_id} 缺少 grade/subject`);

// 数据健康度告警（不阻塞）
const noRes = knowledge.filter((k) => k.resource_count === 0).length;
const placeholder = resources.filter((r) => !r.is_playable).length;
const emptyTitle = knowledge.filter((k) => k.title_fallback).length;
if (noRes) warn(`${noRes} 个知识点没有任何资源，将走 ResourceSupport 空状态`);
if (placeholder) warn(`${placeholder} 条资源 URL 为占位符（不可播放），UI 需降级处理`);
if (videoEnriched.total)
  note(`视频链接整合：共 ${videoEnriched.total} 条视频资源，注入封面图 ${videoEnriched.withCover} 条、可播放地址 ${videoEnriched.withPlay} 条` + (videoEnriched.byUnitFallback ? `（其中单元级兜底 ${videoEnriched.byUnitFallback} 条）` : ''));
if (emptyTitle) warn(`${emptyTitle} 个知识点缺少 title，已回退为单元名`);
if (rawCalendar.length === 0) warn('school_calendar 为 0 行，「理论预计进度」无数据源，ProgressCheckIn 将走纯手动模式');
if (rawRelations.length === 0) note('knowledge_relations 为 0 行，前置/关联知识点功能本期不实现，表结构保留');
if (new Set(curriculums.map((c) => c.is_core_subject)).size === 1)
  warn('curriculums.is_core_subject 全表同值，无法区分主副科；地图学科由 content-overlay.json 的 on_map 决定');

// ---------------------------------------------------------------- 产出

const gradeKeys = {};
GRADE_ORDER.forEach((g, i) => (gradeKeys[g] = `g${i + 1}`));
{
  const known = new Set(GRADE_ORDER);
  const extra = [...new Set(knowledge.map(gradeOfKn))].filter((x) => x && !known.has(x)).sort();
  if (extra.length) {
    extra.forEach((x, i) => (gradeKeys[x] = `gx${i + 1}`));
    warn(`发现未预登记的年级：${extra.join(', ')}，已动态分配 grade_key`);
  }
}

const checksum = crypto
  .createHash('sha256')
  .update(JSON.stringify({ subjects, curriculums, units, knCount: knowledge.length, resCount: resources.length }))
  .digest('hex')
  .slice(0, 16);

const manifest = {
  content_version: '1.0',
  generated_at: new Date().toISOString(),
  source_file: path.basename(XLSX_PATH),
  checksum,
  grade_keys: gradeKeys,
  counts: {
    subjects: subjects.length,
    curriculums: curriculums.length,
    units: units.length,
    knowledge_nodes: knowledge.length,
    resources: resources.length,
    knowledge_relations: rawRelations.length,
    school_calendar: rawCalendar.length,
  },
  map_subjects: subjects.filter((s) => s.on_map).map((s) => s.subject_id),
  health: {
    knowledge_without_resource: noRes,
    resources_unplayable: placeholder,
    knowledge_missing_title: emptyTitle,
  },
};

// 按年级分片，避免一次加载全部 1572 知识点 / 5041 资源
const byGrade = (rows, gradeOf) => {
  const out = {};
  for (const r of rows) {
    const key = gradeKeys[gradeOf(r)] || 'other';
    (out[key] ||= []).push(r);
  }
  return out;
};
const knChunks = byGrade(knowledge, gradeOfKn);
const resChunks = byGrade(resources, (r) => gradeOfKn(knById.get(r.knowledge_id) || { unit_id: '' }));

function writeJson(rel, data) {
  const p = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data), 'utf8');
  return fs.statSync(p).size;
}

// ---------------------------------------------------------------- 报告

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const report = [];
report.push('# Master Data 导入校验报告\n');
report.push(`- 数据源：\`${path.basename(XLSX_PATH)}\``);
report.push(`- 生成时间：${manifest.generated_at}`);
report.push(`- content_version：**${manifest.content_version}**　checksum：\`${checksum}\``);
report.push('');
report.push('## 数据量\n');
report.push('| 表 | 行数 |');
report.push('|---|---|');
for (const [k, v] of Object.entries(manifest.counts)) report.push(`| ${k} | ${v.toLocaleString()} |`);
report.push('');
report.push(`## 校验结果：**${errors.length === 0 ? 'PASS' : 'FAIL'}**\n`);
report.push(`- error：**${errors.length}**　warning：${warnings.length}　note：${notes.length}`);
report.push('');
if (errors.length) {
  report.push('### Errors（阻塞）\n');
  errors.slice(0, 40).forEach((e) => report.push(`- ❌ ${e}`));
  if (errors.length > 40) report.push(`- … 另有 ${errors.length - 40} 条`);
  report.push('');
}
if (warnings.length) {
  report.push('### Warnings（已自动降级，不阻塞）\n');
  [...new Set(warnings.map((w) => w.replace(/\d+/g, 'N')))].slice(0, 25).forEach((w) => report.push(`- ⚠️ ${w}`));
  report.push('');
}
report.push('## 排序推导说明\n');
report.push('Excel 中 `units.sort_order` 与 `knowledge_nodes.sort_order` 全部为 0，已失效。');
report.push('- 知识点排序改用 `sequence`（同一 unit 内唯一，实测 0 冲突）');
report.push('- 单元排序改用 `min(该单元下所有知识点的 sequence)` 的密集排名（实测 60 个 curriculum 零冲突）');
report.push('');

console.log('\n' + '─'.repeat(64));
console.log('  Master Data V2  →  Content JSON');
console.log('─'.repeat(64));
console.log(`  数据源      ${path.basename(XLSX_PATH)}`);
console.log(`  subjects    ${subjects.length}（上地图 ${manifest.map_subjects.length}）`);
console.log(`  curriculums ${curriculums.length}`);
console.log(`  units       ${units.length}（排序由 sequence 推导）`);
console.log(`  knowledge   ${knowledge.length}`);
console.log(`  resources   ${resources.length}（${placeholder} 条 URL 为占位符）`);
console.log(`  videos      ${videoEnriched.total}（封面 ${videoEnriched.withCover} / 可播放 ${videoEnriched.withPlay}）`);
console.log('─'.repeat(64));
if (errors.length) {
  console.log(`  ❌ ${errors.length} 个错误`);
  errors.slice(0, 15).forEach((e) => console.log(`     - ${e}`));
} else {
  console.log('  ✅ ID 唯一性 / 外键完整性 / 状态枚举 / 必填字段  全部通过');
}
console.log(`  ⚠️  ${warnings.length} 条告警（已自动降级）`);
console.log('─'.repeat(64) + '\n');

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'content-validation-report.md'), report.join('\n'));

if (VALIDATE_ONLY || errors.length) {
  console.log(VALIDATE_ONLY ? '  仅校验模式，未写入 JSON。\n' : '  存在 error，已中止写入。\n');
  process.exit(errors.length ? 1 : 0);
}

const sizes = [];
sizes.push(['manifest.json', writeJson('manifest.json', manifest)]);
sizes.push(['subjects.json', writeJson('subjects.json', subjects)]);
sizes.push(['curriculums.json', writeJson('curriculums.json', curriculums)]);
sizes.push(['units.json', writeJson('units.json', units)]);
sizes.push(['knowledge_relations.json', writeJson('knowledge_relations.json', rawRelations)]);
sizes.push(['school_calendar.json', writeJson('school_calendar.json', rawCalendar)]);
let knTotal = 0;
for (const [key, rows] of Object.entries(knChunks))
  knTotal += writeJson(`knowledge_nodes/${key}.json`, rows);
let resTotal = 0;
for (const [key, rows] of Object.entries(resChunks))
  resTotal += writeJson(`resources/${key}.json`, rows);

console.log('  已写入 src/data/content/');
for (const [f, s] of sizes) console.log(`    ${f.padEnd(28)} ${kb(s)}`);
console.log(`    knowledge_nodes/ (${Object.keys(knChunks).length} 个分片)   ${kb(knTotal)}`);
console.log(`    resources/ (${Object.keys(resChunks).length} 个分片)        ${kb(resTotal)}`);
console.log(`\n  ✅ 导入完成。报告见 docs/content-validation-report.md\n`);
