# Supabase 云端后端

本目录是「小学知识成长地图」的**可选**云端同步层。MVP 采用《Implementation_Plan》第 246 行的**可插拔后端**决策：

> 先以 IndexedDB 为唯一数据源跑通全部功能，`syncService` 预留适配器，填入 URL / anon key 后即可启用云同步，不返工。

也就是说：**不配置 Supabase，App 100% 可用（本地模式）**；配置后自动启用多端同步。

## 1. 应用 schema

在 Supabase 控制台 → SQL Editor 粘贴执行 `schema.sql`，或：

```bash
supabase db push          # 若使用 supabase CLI 本地迁移
```

`schema.sql` 包含：

| 对象 | 说明 |
|---|---|
| `profiles` | 家长档案（1:1 投影 `auth.users`） |
| `children` | 孩子档案，owner = `parent_id = auth.uid()` |
| `weekly_reviews` / `review_items` | 复盘及条目（条目永远追加，不覆盖历史） |
| `progress_checkins` | V1.1 进度确认 |
| `assessments` | 考试记录 |
| `growth_records` | 成长时间轴事件 |
| `audio_records` | 录音元数据（Blob 存 Storage） |
| `audio` Storage bucket | 私有，按 `<parent_id>/<id>.webm` 目录隔离 |

- 列名/类型与 `src/types/user.ts`、IndexedDB（`storageService`）**完全一致**，保证 upsert 零转换。
- 所有用户表启用 **RLS**：`children` 直接比对 `auth.uid()`，子表通过 `exists(select ... children where parent_id = auth.uid())` 回查归属。
- 内容数据（subjects / knowledge / resources）**一条都不存**云端（规划第 64、85 行）。

## 2. 启用云同步（运行时）

`syncService` 在 `localStorage` 读取 `growth-map.remote-config`（`{ url, anonKey }`）：

- 未配置 → 状态恒为「已保存到本机」，不联网。
- 配置后 → 状态机在 `已保存到本机 / 正在同步 / 已同步 / 暂时无法同步` 间切换（四态对外文案，禁止暴露技术词）。
- 首次配置会先 `pullAll()` 恢复新设备数据，再 `pushAll()` 推送本机。

**设置凭据的入口**目前由前端调用 `syncService.setConfig({ url, anonKey })` 触发（例如未来在「设置 → 云端同步」面板粘贴，或开发期在控制台调用）。配置后需用户处于**已登录**状态（Supabase Auth session），否则 `pushAll` 抛 `NO_AUTH_SESSION` 并转为「暂时无法同步」。

## 3. 本地优先的数据流

```
写操作 → userDataService → 先写 IndexedDB（立即返回）
                             ↓ 该行 sync_state 置 'pending'（即 outbox）
                  syncService（后台 / 联网 / 配置就绪时）
                             ↓ pushAll：Supabase upsert → markAllSynced 出队
                             ↓ 失败：指数退避重试（1s/5s/30s/2min/10min）
登录时反向 pullAll：children → 各子表 → 写回 IndexedDB
```

- 离线永远可写；联网自动补推。
- 冲突：`updated_at` 较新者胜，永不删除历史 `review_item`。

## 4. 待接入（超出 MVP 的 Phase 2-4 收尾项）

- **Supabase Auth 登录/注册 UI**：目前 adapter 已就绪，但缺少家长登录界面；没有 session，`pushAll` 不会真正落库。
- **真实凭据**：填入项目的 URL + anon key（及 Storage CORS 配置）。
- **录音 Blob 上传**：`AudioRecorder` 已把 Blob 存本地 `audio_blobs`，`pushAll` 目前只同步元数据，`storage_path` 上的文件上传需补充一段 Storage 上传逻辑。
