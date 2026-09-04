/**
 * Content Data 类型定义 —— 全部由 tools/import-master-data.mjs 从
 * Master Data V2 生成，运行时只读。
 *
 * 约束：
 *   - 核心关联一律用 Stable ID，禁止按名称关联
 *   - 学科相关内容（名称/图标/是否上地图）Data Driven，禁止硬编码
 */

export interface Subject {
  subject_id: string;
  subject: string;
  display_name: string;
  status: string;
  display_order: number;
  /** 是否渲染为地图区域；false 的收进「兴趣拓展」次级入口 */
  on_map: boolean;
  map_name: string;
  map_icon: string;
  color: string;
  description: string;
  map_name_source: 'excel' | 'overlay';
  display_order_source: 'excel' | 'overlay';
}

export interface Curriculum {
  curriculum_id: string;
  stage: string;
  grade: string;
  subject: string;
  subject_id: string;
  textbook: string;
  semester: string;
  semester_raw: string;
  status: string;
  content_version: string;
  display_order: number;
  is_core_subject: boolean;
  map_name: string;
  map_icon: string;
  map_area: string;
  description: string;
}

export interface Unit {
  unit_id: string;
  curriculum_id: string;
  grade: string;
  subject: string;
  subject_id: string;
  textbook: string;
  semester: string;
  unit_name: string;
  status: string;
  content_version: string;
  /** 由下属知识点的最小 sequence 推导（Excel 的 sort_order 全为 0） */
  sort_order: number;
  sort_order_source: string;
  knowledge_count: number;
}

export interface KnowledgeNode {
  knowledge_id: string;
  unit_id: string;
  grade: string;
  subject: string;
  subject_id: string;
  textbook: string;
  semester: string;
  unit_name: string;
  title: string;
  /** Excel 中 title 为空时回退为单元名 */
  title_fallback: boolean;
  sequence: number;
  sort_order: number;
  knowledge_type: string;
  importance: string;
  map_area: string;
  map_position: string;
  status: string;
  data_origin: string;
  data_quality: string;
  content_version: string;
  resource_count: number;
}

export interface Resource {
  resource_id: string;
  knowledge_id: string;
  grade: string;
  subject: string;
  resource_type: string;
  title: string;
  url: string;
  /**
   * 是否可「直接播放」。
   * true  = 有源平台可播放地址(苏e优课 chapter_id 拼出)，可 iframe 内嵌播放。
   * false = 仅有封面图(来自苏e新课)或无任何链接，需跳源平台观看。
   */
  is_playable: boolean;
  duration_sec: number;
  teacher: string;
  /** 真实封面图（腾讯云点播快照），来自用户提供的视频 Excel；为空则无缩略图 */
  cover_url: string;
  /** 可播放地址：源平台详情页(chapter_id 拼出)，仅苏e优课视频有 */
  play_url: string;
  /** 苏e优课详情页的课时 ID，用于拼 play_url / 复盘溯源 */
  chapter_id: string;
  /** 资源来源模块：苏e优课 / 苏e新课，用于 UI 标注 */
  source_module: string;
  source_platform: string;
  availability: string;
  status: string;
  content_version: string;
  sort_order: number;
}

export interface ContentManifest {
  content_version: string;
  generated_at: string;
  source_file: string;
  checksum: string;
  grade_keys: Record<string, string>;
  counts: Record<string, number>;
  map_subjects: string[];
  health: {
    knowledge_without_resource: number;
    resources_unplayable: number;
    knowledge_missing_title: number;
  };
}
