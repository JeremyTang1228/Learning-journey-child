/**
 * Content Service —— Content Data 的唯一读取入口。
 *
 * 开发总 Prompt 第 60 节：页面只关心 getSubjects()/getUnits()/getKnowledge()/getResources()，
 * 不关心 JSON 在哪里。未来从 JSON 换成 Supabase Content DB，页面不需要修改。
 *
 * 数据来源全部是 Master Data V2 导出的静态 JSON：
 *   - 永不在运行时读取 Excel
 *   - 核心关联一律用 Stable ID
 *   - 学科名称 / 图标 / 是否上地图 一律来自 subjects.json，禁止硬编码
 */
import type {
  ContentManifest,
  Curriculum,
  KnowledgeNode,
  Resource,
  Subject,
  Unit,
} from '@/types/content';
import manifestJson from '../data/content/manifest.json';
import subjectsJson from '../data/content/subjects.json';
import curriculumsJson from '../data/content/curriculums.json';
import unitsJson from '../data/content/units.json';

/** 按年级分片的大表，运行时按需加载（1572 知识点 / 5041 资源不一次进包） */
const KN_LOADERS = import.meta.glob<KnowledgeNode[]>('../data/content/knowledge_nodes/*.json');
const RES_LOADERS = import.meta.glob<Resource[]>('../data/content/resources/*.json');

/** 单元 + 从 curriculum 推导出的归属信息 */
export interface HydratedUnit extends Unit {
  grade: string;
  subject: string;
  subject_id: string;
  textbook: string;
  semester: string;
}

/** 知识点 + 从 unit → curriculum 推导出的归属信息 */
export interface HydratedKnowledge extends KnowledgeNode {
  grade: string;
  subject: string;
  subject_id: string;
  textbook: string;
  semester: string;
  curriculum_id: string;
  unit_name: string;
}

const PUBLISHED = 'published';

class ContentService {
  private manifest: ContentManifest = manifestJson as ContentManifest;
  private subjects: Subject[] = (subjectsJson as Subject[]).filter((s) => s.status === PUBLISHED);
  private curriculums: Curriculum[] = (curriculumsJson as Curriculum[]).filter(
    (c) => c.status === PUBLISHED
  );
  private units: Unit[] = (unitsJson as Unit[]).filter((u) => u.status === PUBLISHED);

  private unitIndex = new Map<string, HydratedUnit>();
  private curIndex = new Map<string, Curriculum>();
  private subjectIndex = new Map<string, Subject>();

  /** 已加载年级的知识点，按 unit_id 分组 */
  private knByUnit = new Map<string, Map<string, HydratedKnowledge[]>>();
  private knById = new Map<string, HydratedKnowledge>();
  private resByKn = new Map<string, Resource[]>();
  private loadedGrades = new Set<string>();
  private loading = new Map<string, Promise<void>>();

  constructor() {
    for (const c of this.curriculums) this.curIndex.set(c.curriculum_id, c);
    for (const s of this.subjects) this.subjectIndex.set(s.subject_id, s);
    for (const u of this.units) {
      const c = this.curIndex.get(u.curriculum_id);
      this.unitIndex.set(u.unit_id, {
        ...u,
        grade: c?.grade ?? '',
        subject: c?.subject ?? '',
        subject_id: c?.subject_id ?? '',
        textbook: c?.textbook ?? '',
        semester: c?.semester ?? '',
      });
    }
  }

  // ---------------------------------------------------------------- 元信息

  getManifest() {
    return this.manifest;
  }

  /** 写入 review_item 时一并记录，用于追溯复核时使用的是哪一版内容 */
  getContentVersion() {
    return this.manifest.content_version;
  }

  private gradeKey(grade: string) {
    return this.manifest.grade_keys[grade] ?? 'other';
  }

  // ---------------------------------------------------------------- 学科

  /** 全部已发布学科，按 display_order 排序 */
  getSubjects(): Subject[] {
    return this.subjects;
  }

  /** 渲染为地图区域的学科（由 subjects.json 的 on_map 决定，不硬编码） */
  getMapSubjects(): Subject[] {
    return this.subjects.filter((s) => s.on_map);
  }

  /** 收进「兴趣拓展」次级入口的学科 */
  getExtraSubjects(): Subject[] {
    return this.subjects.filter((s) => !s.on_map);
  }

  getSubject(id: string): Subject | undefined {
    return this.subjectIndex.get(id);
  }

  // ---------------------------------------------------------------- 课程 / 单元

  getCurriculums(grade: string, subjectId?: string): Curriculum[] {
    return this.curriculums
      .filter((c) => c.grade === grade && (!subjectId || c.subject_id === subjectId))
      .sort((a, b) => a.display_order - b.display_order);
  }

  getCurriculum(id: string): Curriculum | undefined {
    return this.curIndex.get(id);
  }

  /** 课程下的单元，按推导出的 sort_order 排序 */
  getUnits(curriculumId: string): HydratedUnit[] {
    return this.units
      .filter((u) => u.curriculum_id === curriculumId)
      .map((u) => this.unitIndex.get(u.unit_id)!)
      .filter(Boolean)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  getUnit(unitId: string): HydratedUnit | undefined {
    return this.unitIndex.get(unitId);
  }

  /** 某年级某学科下的全部单元（跨教材版本，按课程顺序 + 单元序排序） */
  getUnitsByGradeSubject(grade: string, subjectId: string): HydratedUnit[] {
    const curs = this.getCurriculums(grade, subjectId);
    return curs.flatMap((c) => this.getUnits(c.curriculum_id));
  }

  // ---------------------------------------------------------------- 分级懒加载

  /** 预加载某年级的知识点与资源。重复调用会复用同一个 Promise。 */
  async loadGrade(grade: string): Promise<void> {
    if (this.loadedGrades.has(grade)) return;
    const pending = this.loading.get(grade);
    if (pending) return pending;

    const key = this.gradeKey(grade);
    const task = (async () => {
      const knLoader = KN_LOADERS[`../data/content/knowledge_nodes/${key}.json`];
      const resLoader = RES_LOADERS[`../data/content/resources/${key}.json`];
      const [knRaw, resRaw] = await Promise.all([
        knLoader ? knLoader() : Promise.resolve([] as KnowledgeNode[]),
        resLoader ? resLoader() : Promise.resolve([] as Resource[]),
      ]);
      // Vite 的 glob 类型在不同配置下可能是数组，也可能是 { default: 数组 }
      const knRows: KnowledgeNode[] = Array.isArray(knRaw) ? knRaw : (knRaw as { default: KnowledgeNode[] }).default ?? [];
      const resRows: Resource[] = Array.isArray(resRaw) ? resRaw : (resRaw as { default: Resource[] }).default ?? [];

      const byUnit = new Map<string, HydratedKnowledge[]>();
      for (const k of knRows) {
        if (k.status !== PUBLISHED) continue;
        const u = this.unitIndex.get(k.unit_id);
        if (!u) continue;
        const hk: HydratedKnowledge = {
          ...k,
          grade: u.grade,
          subject: u.subject,
          subject_id: u.subject_id,
          textbook: u.textbook,
          semester: u.semester,
          curriculum_id: u.curriculum_id,
          unit_name: u.unit_name,
        };
        this.knById.set(k.knowledge_id, hk);
        if (!byUnit.has(k.unit_id)) byUnit.set(k.unit_id, []);
        byUnit.get(k.unit_id)!.push(hk);
      }
      for (const [, list] of byUnit) list.sort((a, b) => a.sequence - b.sequence);
      this.knByUnit.set(grade, byUnit);

      for (const r of resRows) {
        if (r.status !== PUBLISHED) continue;
        if (!this.resByKn.has(r.knowledge_id)) this.resByKn.set(r.knowledge_id, []);
        this.resByKn.get(r.knowledge_id)!.push(r);
      }
      this.loadedGrades.add(grade);
      this.loading.delete(grade);
    })();

    this.loading.set(grade, task);
    return task;
  }

  isGradeLoaded(grade: string) {
    return this.loadedGrades.has(grade);
  }

  // ---------------------------------------------------------------- 知识点

  /** 单元下的知识点，按 sequence 排序。需先 await loadGrade(grade)。 */
  getKnowledge(unitId: string): HydratedKnowledge[] {
    const u = this.unitIndex.get(unitId);
    if (!u) return [];
    return this.knByUnit.get(u.grade)?.get(unitId) ?? [];
  }

  getKnowledgeById(id: string): HydratedKnowledge | undefined {
    return this.knById.get(id);
  }

  /** 某单元下所有知识点（自动加载所属年级） */
  async getKnowledgeFor(unitId: string): Promise<HydratedKnowledge[]> {
    const u = this.unitIndex.get(unitId);
    if (!u) return [];
    await this.loadGrade(u.grade);
    return this.getKnowledge(unitId);
  }

  // ---------------------------------------------------------------- 资源

  /**
   * 知识点下 1～3 个最相关资源（开发总 Prompt 第 53 节：不把所有资源堆给用户）。
   * is_playable=false 的资源仍会返回，由 UI 决定降级展示。
   */
  getResources(knowledgeId: string, limit = 3): Resource[] {
    const all = this.resByKn.get(knowledgeId) ?? [];
    const typeRank = (t: string) => {
      if (t === 'video') return 0;
      if (t === 'audio') return 1;
      return 2;
    };
    const sorted = [...all].sort((a, b) => {
      // 视频 > 音频 > 其他；同类型内可播放优先；最后按 sort_order
      const ta = typeRank(a.resource_type);
      const tb = typeRank(b.resource_type);
      if (ta !== tb) return ta - tb;
      if (a.is_playable !== b.is_playable) return a.is_playable ? -1 : 1;
      return a.sort_order - b.sort_order;
    });
    return limit ? sorted.slice(0, limit) : sorted;
  }

  /** 按类型取资源，用于 ResourceSupport 的三分区 */
  getResourcesByType(knowledgeId: string, types: string[]): Resource[] {
    const all = this.resByKn.get(knowledgeId) ?? [];
    return all.filter((r) => types.includes(r.resource_type));
  }

  // ---------------------------------------------------------------- 统计

  /** 某学科在某年级的知识点总数（用于"已探索 %"） */
  countKnowledge(grade: string, subjectId: string): number {
    const byUnit = this.knByUnit.get(grade);
    if (!byUnit) return 0;
    let n = 0;
    for (const [, list] of byUnit) for (const k of list) if (k.subject_id === subjectId) n += 1;
    return n;
  }
}

export const contentService = new ContentService();
