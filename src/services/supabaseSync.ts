/**
 * Supabase 云端适配器 —— syncService 在配置好远端凭据后动态加载（不进主包）。
 *
 * 与 Implementation_Plan 第 88-101 行一致：
 *   - pushAll：把本机 outbox（sync_state !== synced）upsert 到云端，成功后 markAllSynced 出队
 *   - pullAll：登录/换设备时反向拉取，写回 IndexedDB（新设备恢复）
 *   - 冲突策略：updated_at 较新者胜（Supabase upsert + 本机覆盖式写入）
 *
 * 注意：云端以「家长」为 owner，children.parent_id = auth.uid()::text。
 * 本地模式的 LOCAL_PARENT_ID 在推送时映射为真实 uid。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as userData from './userDataService';

export type RemoteTable =
  | 'children'
  | 'weekly_reviews'
  | 'review_items'
  | 'progress_checkins'
  | 'assessments'
  | 'growth_records'
  | 'audio_records';

/** 推送顺序：先父后子，满足外键约束 */
const PUSH_ORDER: RemoteTable[] = [
  'children',
  'weekly_reviews',
  'review_items',
  'progress_checkins',
  'assessments',
  'growth_records',
  'audio_records',
];

const CHILD_OWNED: RemoteTable[] = PUSH_ORDER.slice(1);

let client: SupabaseClient | null = null;

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  client = createClient(url, anonKey, {
    // 持久化会话：登录态可跨刷新保留，换设备/重开 App 无需重新登录
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export function getSupabase(): SupabaseClient | null {
  return client;
}

export function resetSupabase(): void {
  client = null;
}

// ------------------------------------------------------------ Auth 封装

export async function signIn(email: string, password: string): Promise<void> {
  if (!client) throw new Error('NO_CLIENT');
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email: string, password: string): Promise<string | null> {
  if (!client) throw new Error('NO_CLIENT');
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  // 若后台开启了「邮箱验证」，data.session 为 null，需先完成邮件确认才能登录
  return data.session ? email : null;
}

export async function signOutAuth(): Promise<void> {
  if (!client) return;
  await client.auth.signOut();
}

export async function currentUserEmail(): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.email ?? null;
}

async function currentUid(): Promise<string | null> {
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * 把本机待同步数据推送到云端。
 * 未登录（无 session）时抛 NO_AUTH_SESSION，由 syncService 转为「暂时无法同步」。
 */
export async function pushAll(): Promise<void> {
  const uid = await currentUid();
  if (!uid) throw new Error('NO_AUTH_SESSION');
  if (!client) throw new Error('NO_CLIENT');

  const groups = await userData.getAllPending();

  // children：LOCAL_PARENT_ID → 真实 uid
  const childrenRows = groups.children.map((c) => ({ ...c, parent_id: uid }));
  const { error: e1 } = await client.from('children').upsert(childrenRows);
  if (e1) throw e1;

  for (const t of CHILD_OWNED) {
    const rows = (groups as Record<string, unknown[]>)[t];
    if (rows.length === 0) continue;
    const { error } = await client.from(t).upsert(rows);
    if (error) throw error;
  }

  // 推送成功 → outbox 出队
  await userData.markAllSynced(groups);
}

/**
 * 反向拉取（新设备恢复 / 换端登录）。
 * 拉取顺序不强制（本机覆盖式写入，主键一致即幂等）。
 */
export async function pullAll(): Promise<void> {
  const uid = await currentUid();
  if (!uid) throw new Error('NO_AUTH_SESSION');
  if (!client) throw new Error('NO_CLIENT');

  const { data: children, error: e1 } = await client
    .from('children')
    .select('*')
    .eq('parent_id', uid);
  if (e1) throw e1;

  const childIds = (children ?? []).map((c: { id: string }) => c.id);
  const groups: Record<RemoteTable, unknown[]> = {
    children: children ?? [],
    weekly_reviews: [],
    review_items: [],
    progress_checkins: [],
    assessments: [],
    growth_records: [],
    audio_records: [],
  };

  for (const t of CHILD_OWNED) {
    if (childIds.length === 0) break;
    const { data, error } = await client.from(t).select('*').in('child_id', childIds);
    if (error) throw error;
    groups[t] = data ?? [];
  }

  await userData.upsertFromRemote(groups as Awaited<ReturnType<typeof userData.getAllPending>>);
}
