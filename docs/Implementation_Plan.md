# 小学知识成长地图 PWA · Implementation Plan

> Phase 0 交付物。依据《Workbuddy MVP 开发总 Prompt V1.1》第 77–78 节要求产出。
> 已阅读资产：01_开发规范（总 Prompt 2647 行）、02_Master_Data（V2 内容管理版 + 数据字典）、03_UI_Prototype（10 份原型）、04_Design_Preference（V1.1 设计校准报告 + UI 设计 Prompt）。

---

## 0. 阅读结论摘要

原型、Design System、产品逻辑三者一致，可以直接工程化，**不需要重新设计**。
但 Master Data 存在 9 个必须在写代码前定案的问题（见第 2 节），其中 5 个会让"照抄原型"直接产出 bug。

---

## 1. 规范第 78 节的 10 个必答问题

### ① 10 个 Claude 文件分别对应什么页面 / 组件？

| 原型文件 | 工程落点 | 说明 |
|---|---|---|
| `DesignSystem.html` | `src/styles/tokens.css` + `src/components/ui/` | 14 个 CSS 变量直接落成 design token；五态色、硬阴影、wobble 滤镜抽成组件属性 |
| `Overview.html` | `src/app/router.tsx` + `src/components/BottomNav.tsx` | 信息架构源：4 个固定 Tab + 2 个钻取页 |
| `GrowthMapHome.html` | `src/pages/GrowthMapHome/` | 年级带、学科区域、Unit 地标、Knowledge 节点、角色头像、节点 BottomSheet |
| `WeeklyReview.html` | `src/pages/WeeklyReview/` | Step1 本周内容确认 → Step2 逐项复盘 → Step3 完成页 |
| `ProgressCheckIn.html` | `src/components/ProgressCheckIn.tsx` | V1.1 新增 Bottom Sheet，插在 WeeklyReview Step1 **之前** |
| `KnowledgeCard.html` | `src/pages/KnowledgeCard/` | 状态徽章 + 成长变化时间线 + 视频/资料/录音三分区 |
| `ResourceSupport.html` | `src/pages/ResourceSupport/` | 三 Tab + "重新确认"闭环（**追加** review_items，不覆盖） |
| `ParentDashboard.html` | `src/pages/ParentDashboard/` | 环形掌握度 + 学科条 + 需要关注（≤3）+ V1.1 新增两张摘要卡 |
| `GrowthTimeline.html` | `src/pages/GrowthTimeline/` | 年级 chip + 月度事件时间轴 |
| `Settings.html` | `src/pages/Settings/` | 孩子信息、家庭成员、提醒、数据隐私、关于 + V1.1 新增恢复态/二次确认/同步状态 |

页面关系（`Overview.html` 已定死）：

```
底部 4 Tab（无先后顺序，状态互不丢失）
  🗺️ 成长地图(默认)   📋 本周复盘   📊 家长看板   🌱 成长档案
                 │
                 ├─ 点节点 / 点需要关注 / 点历史事件 ─→ 🌟 KnowledgeCard
                 │                                        └→ 🧰 ResourceSupport
                 └─ 返回原页，状态已更新
```

### ② Master Data 如何进入 App？

```
小学知识成长地图_Master_Data_V2_内容管理版.xlsx   （Source of Truth，不入库）
        ↓  tools/import-master-data.mjs（Node + xlsx）
        ↓  清洗 → 归一化 → 校验 → 排序推导
src/data/content/*.json  +  content_manifest.json（含 content_version / checksum / 行数）
        ↓  build 时 import
contentService（唯一读取入口）
        ↓
UI
```

Excel **永不上传 Supabase**，也**不在运行时读取**。

### ③ 哪些内容来自 JSON？

`subjects` / `curriculums` / `units` / `knowledge_nodes` / `resources` / `knowledge_relations` / `school_calendar` / `map_themes`（见问题 4 的降级方案）。
全部只读，按 `status === 'published'` 过滤后暴露。

### ④ 哪些内容来自 Supabase？

`profiles` / `children` / `weekly_reviews` / `review_items` / `assessments` / `growth_records` / `progress_checkins` / `audio_records` + Storage（录音文件）。

### ⑤ 用户数据如何关联 knowledge_id？

- `review_items.knowledge_id`、`progress_checkins.actual_unit_id`、`growth_records.knowledge_id`、`audio_records.knowledge_id` 全部存 **Stable ID 字符串**。
- 严禁按名称关联；`knowledge_id` 永不因改名/改资源/改排序而变化。
- 每条 `review_item` 额外记录 `content_version`，可追溯复核时用的是哪一版内容。

### ⑥ IndexedDB 存什么？

| Store | 内容 |
|---|---|
| `content_cache` | 内容 JSON 镜像（按 content_version 分片），离线启动用 |
| `children` / `weekly_reviews` / `review_items` / `assessments` / `growth_records` / `progress_checkins` | 用户数据本地全量镜像 |
| `outbox` | 待同步队列，每条带 `sync_state: pending/syncing/synced/failed` + `retry_count` |
| `audio_blobs` | 录音 Blob，同步成功转 Supabase Storage 后清理 |

### ⑦ Supabase 存什么？

用户数据的**云端权威副本**（同 ⑥ 中除 `content_cache`/`outbox` 外的全部），以及 Storage 里的音频文件。
内容数据一条都不存。

### ⑧ 同步如何实现？

```
写操作 → userDataService → 先写 IndexedDB（立即成功）→ outbox 入队(pending)
                                    ↓
                          syncService（后台，网络/登录就绪时）
                                    ↓
                     syncing → Supabase upsert → synced（清理 outbox）
                                    ↓ 失败
                          failed + 指数退避重试（1s/5s/30s/2min/10min，上限 8 次）
```

- 冲突：`updated_at` 较新者胜；**永不删除历史 review**。
- 登录时反向 `pull`：children → weekly_reviews → review_items → assessments → growth_records → 写入 IndexedDB。
- 对外文案只暴露四种："已保存到本机 / 正在同步 / 已同步 / 暂时无法同步"。

### ⑨ 未来如何更新 Master Data？

```bash
# 1. 改 Excel（改状态用 status 列，禁止物理删除行）
# 2. 执行导入
npm run import:content          # 清洗 + 校验 + 生成 JSON
npm run validate:content        # 只校验不产出，CI 可挂
# 3. 校验通过后 content_version +1，重新部署
```

新增一个知识点的具体操作：在 `knowledge_nodes` 表新增一行 → 生成唯一 `knowledge_id` → 填 `unit_id` → `status=published` → 如需资源在 `resources` 新增行并用同一 `knowledge_id` 挂载 → 跑导入。**全程不改代码。**

### ⑩ 未来如何迁移 Content DB？

`contentService` 是唯一接口，底层走 adapter：

```
contentService
   ├── JsonContentAdapter   （MVP：读本地 JSON）
   └── SupabaseContentAdapter（未来：读 Supabase content 表）
```

页面只调 `getSubjects()/getCurriculums()/getUnits()/getKnowledge()/getResources()`，换 adapter 时**页面零改动**。

---

## 2. Master Data 数据质量校验结果（关键）

对 60/459/1572/5041 行全量校验后，发现 9 个问题。**加粗的是会直接导致 bug 的**。

| # | 问题 | 实测 | 工程解法 |
|---|---|---|---|
| 1 | **`knowledge_nodes.status` 用 `active`，不在规范枚举内** | 1572/1572 全为 `active`（其余表均为 `published`） | import 时归一化 `active → published`；校验器接受该别名但告警 |
| 2 | **`units.sort_order`、`kn.sort_order` 全部为 0** | 459/459 与 1572/1572 均为 `0` | 改用 `kn.sequence`（unit 内唯一，**0 冲突**）；unit 顺序用 `min(下属 kn.sequence)`，实测 60 个 curriculum **零冲突** |
| 3 | **`subject_config.display_order` 全 99、`is_core_subject` 全 True** | 10 个学科无任何区分度 | 无法推出主副科 → 需产品决策，见下方"待确认 ②" |
| 4 | **`curriculums.map_name/map_icon/map_area` 与 `kn.map_area/map_position` 全空** | 60 + 1572 行全空 | 原型里的"汉字森林/数字王国/英语小镇"目前无数据支撑。方案：生成**外部可覆盖的** `map_themes.json`（学科 → 名称/图标/色相），不写死进组件 |
| 5 | **1794/5041 资源 `url` 是占位符「打开视频」** | 与 video 类型行数完全一致（1794），即**全部视频无真实播放地址** | UI 降级：显示 cover + "该视频需在原平台观看"，**不假装可播放**。其余 3247 条 http 链接可正常打开 |
| 6 | 129 个知识点无任何资源 | 分布：0 资源 129 个 | 走 ResourceSupport 空状态（原型已有），不报错 |
| 7 | 48 个知识点 `title` 为空 | 小学英语 39 / 语文 4 / 美术 2 / 音乐 2 / 信息 1 | fallback 用 `unit_name`；仍空则显示"（待补充）" |
| 8 | **`school_calendar` 0 行** | 无"理论预计进度"数据源 | ProgressCheckIn 走**纯手动模式**：允许家长直接选 Unit，不依赖预测（校准报告附录 A 的降级方案） |
| 9 | `semester` 字段脏数据 | 出现 `三年级`、`三年级上册`、`义务教育教科书《艺术 唱游·音乐》二年级下册` 等非枚举值 | import 时正则归一化到 `上册/下册`，无法识别则保留原值并记入校验告警 |

**校验通过项**：ID 唯一性（4 张表 0 重复）、外键完整性（units→curriculums、kn→units、res→kn **0 缺失、0 孤儿**）、content_version 一致（全部 1.0）。→ **核心关系链是干净的**，可以放心按 ID 关联。

---

## 3. V1.1 设计校准报告要求的 9 项增量修改

校准报告是 04_Design_Preference 里的 P0/P1 清单，必须在 MVP 内实现（不是可选项）：

| # | 页面 | 修改 |
|---|---|---|
| 01 | 全局 | 新增"实际学习进度确认"组件（ProgressCheckIn） |
| 02 | 全局 | 新增离线/同步状态条，四态文案逐字使用 |
| 03 | WeeklyReview | 增加"这周先不复盘"与"补录之前的复盘"两个入口 |
| 04 | GrowthMapHome | 地图区域改为数据驱动，砍掉写死的三学科 |
| 05 | ParentDashboard | 补充"本周学了什么"与"最近考试"两张摘要卡 |
| 06 | KnowledgeCard | 增加"第 N 次复核"标签，区分"从未复核"与"本次未覆盖"两种空历史 |
| 07 | GrowthTimeline | 新增"跳过"事件类型、补录角标、日常记录按周合并 |
| 08 | Settings | 新增数据恢复态、退出登录二次确认 |
| 09 | ResourceSupport | 增加"稍后再处理"退出路径 |

**文案红线**（Handoff Notes 明确要求，实现时禁止违反）：
- 禁止出现"未完成 / 失败 / 落后 / 连续中断 / 差距 / 超前"等负面或量化比较词。
- ⚪ 未复核**只能**是中性灰，不得渲染成"不合格/待处理"，不得用红色系。
- `assessments`（分数）与 `review_items`（掌握状态）任何界面都不得互相换算或覆盖。
- 地图角色前进**只能**由一次显式确认（复盘完成 / 进度确认）触发，禁止定时器或实时百分比驱动。
- 同步状态禁止出现 IndexedDB / Supabase / API Error 等技术词。

---

## 4. 技术选型

| 层 | 选型 | 理由 |
|---|---|---|
| 框架 | React 18 + TypeScript + Vite | 规范第 58 节推荐结构，PWA 生态成熟 |
| 路由 | React Router v6 | 4 Tab + 2 钻取页，需保留返回来源 |
| 状态 | Zustand | 轻量，适合"当前孩子 / 当前周 / 同步状态"这类全局少量状态 |
| 本地库 | idb（IndexedDB 封装） | 规范第 31 节强制要求 IndexedDB |
| 云端 | Supabase（Auth + Postgres + Storage） | 规范第 8 节 |
| PWA | 手写 manifest + 手写 service worker（`public/manifest.webmanifest` + `public/sw.js`，`main.tsx` 中注册） | 轻量离线缓存 + 可安装，未引入 vite-plugin-pwa |
| 样式 | 原生 CSS + CSS 变量 | Design System 已是 14 个 CSS 变量，无需引入 UI 库 |
| 导入工具 | Node + SheetJS | 离线运行，不依赖 Python |

---

## 5. 目录结构

```
src/
├── pages/
│   ├── GrowthMapHome/    地图、年级带、学科区域、Unit 地标、节点 Sheet
│   ├── WeeklyReview/     Step1 内容确认 / Step2 逐项 / Step3 完成
│   ├── KnowledgeCard/    状态徽章、成长时间线、资源分区
│   ├── ResourceSupport/  视频/资料/讲给我听 + 重新确认
│   ├── ParentDashboard/  环形掌握度、本周学了什么、需要关注、最近考试
│   ├── GrowthTimeline/   年级 chip、月度事件轴
│   └── Settings/         孩子信息、家庭、提醒、隐私、恢复态
├── components/
│   ├── ui/               Card / Button / StatusDot / Ring / Bar / Sheet / EmptyState / SyncBadge
│   └── ProgressCheckIn/  V1.1 新增
├── data/content/         subjects.json  curriculums.json  units.json
│                         knowledge_nodes.json  resources.json
│                         school_calendar.json  map_themes.json  manifest.json
├── services/
│   ├── contentService.ts      只读内容，adapter 化
│   ├── userDataService.ts     children/reviews/assessments/growth
│   ├── syncService.ts         outbox → Supabase
│   ├── storageService.ts      IndexedDB 封装
│   └── audioService.ts        录音 → Blob → IndexedDB → Storage
├── store/                appStore（当前孩子）、syncStore
├── utils/                date(周计算)、status(五态映射)、order(排序推导)
└── styles/               tokens.css（Design System 14 变量）、global.css
tools/
├── import-master-data.mjs   Excel → JSON
└── validate-master-data.mjs 数据校验（CI 可挂）
supabase/
└── schema.sql             建表 + 索引 + RLS + Storage policy
```

---

## 6. 分阶段排期

| Phase | 内容 | 验收 |
|---|---|---|
| 0 | 本计划 | ✅ 已产出 |
| 1 | 导入 + 校验 + contentService | `npm run import:content` 跑通，60/459/1572/5041 全量进 JSON，校验 0 error |
| 2 | Supabase schema + RLS + Auth | schema.sql 可执行，RLS 隔离通过 |
| 3 | IndexedDB + outbox | 断网可写，联网自动同步 |
| 4 | syncService | 在线/离线/失败重试/新设备恢复 四种路径通过 |
| 5 | 成长地图 | 真实渲染一年级语文/数学/英语 的 Unit 与节点 |
| 6 | 周复盘（含 ProgressCheckIn） | 完整走通：确认进度 → 孩子自评 → 家长判断 → 保存 → 地图更新 |
| 7 | 知识卡 | 状态 + 历史 + 资源 + "第 N 次复核" |
| 8 | 家长看板 | 四张摘要卡，异常按 review_count 排序 |
| 9 | 成长档案 | 年级切换、跳过事件、补录角标、按周合并 |
| 10 | PWA / 离线 / 打磨 | 可安装、离线可用、四态齐全 |

---

## 7. 待确认事项（阻塞 Phase 1 之后的决策）

### ① Supabase 是否已就绪？
规范第 2/8 节要求 Auth+DB+Storage。若无现成项目，将采用**可插拔后端**：先以 IndexedDB 为唯一数据源跑通全部功能，`syncService` 预留适配器，填入 URL/anon key 后即可启用云同步，不返工。

### ② 地图展示哪些学科？（校准报告 P0，明确要求产品决策）
`subject_config` 有 10 个学科（语文/数学/英语/科学/美术/音乐/书法/信息科技/劳动科技/心理健康），但 `display_order` 全 99、`is_core_subject` 全 True，**数据上完全无法区分主副科**。原型只画了语文/数学/英语 3 个区域。
校准报告明确禁止前端自行全量渲染 10 个学科。

### ③ 视频资源无真实播放地址，如何处理？
1794 条视频资源 `url` 为占位符「打开视频」，仅有封面图。处理方式需要定：降级为"在原平台观看"入口 / 预留字段等后续补录 / 其他。

### ④ 首轮交付范围
是否一次交付 Phase 1–10 全量，还是先交付"数据层 + 地图 + 周复盘"这条主链路验证后再继续。
