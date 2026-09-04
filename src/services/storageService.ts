/**
 * Storage Service —— IndexedDB 封装。
 *
 * 开发总 Prompt 第 31 节：核心用户数据必须用 IndexedDB，不能只用 LocalStorage。
 * 原因：容量更大、适合录音、支持离线数据、支持同步队列。
 *
 * 定位：本地缓存 + 离线工作区，不是独立数据源（第 36 节）。
 */
import { openDB, type IDBPDatabase } from 'idb';
import type {
  Assessment,
  AudioRecord,
  Child,
  GrowthRecord,
  ProgressCheckIn,
  ReviewItem,
  WeeklyReview,
} from '@/types/user';

const DB_NAME = 'growth-map';
const DB_VERSION = 1;

export type StoreName =
  | 'children'
  | 'weekly_reviews'
  | 'review_items'
  | 'progress_checkins'
  | 'assessments'
  | 'growth_records'
  | 'audio_records'
  | 'audio_blobs';

interface Schema {
  children: Child;
  weekly_reviews: WeeklyReview;
  review_items: ReviewItem;
  progress_checkins: ProgressCheckIn;
  assessments: Assessment;
  growth_records: GrowthRecord;
  audio_records: AudioRecord;
  audio_blobs: { id: string; blob: Blob };
}

let dbPromise: Promise<IDBPDatabase<unknown>> | null = null;
let unavailable = false;

function getDB() {
  if (unavailable) return Promise.reject(new Error('IndexedDB 不可用'));
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('children')) {
          db.createObjectStore('children', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('weekly_reviews')) {
          const s = db.createObjectStore('weekly_reviews', { keyPath: 'id' });
          s.createIndex('child_week', ['child_id', 'week_start']);
          s.createIndex('child_id', 'child_id');
        }
        if (!db.objectStoreNames.contains('review_items')) {
          const s = db.createObjectStore('review_items', { keyPath: 'id' });
          s.createIndex('child_id', 'child_id');
          s.createIndex('review_id', 'review_id');
          s.createIndex('knowledge_id', 'knowledge_id');
        }
        if (!db.objectStoreNames.contains('progress_checkins')) {
          const s = db.createObjectStore('progress_checkins', { keyPath: 'id' });
          s.createIndex('child_week', ['child_id', 'week_start']);
        }
        if (!db.objectStoreNames.contains('assessments')) {
          const s = db.createObjectStore('assessments', { keyPath: 'id' });
          s.createIndex('child_id', 'child_id');
        }
        if (!db.objectStoreNames.contains('growth_records')) {
          const s = db.createObjectStore('growth_records', { keyPath: 'id' });
          s.createIndex('child_id', 'child_id');
          s.createIndex('record_date', 'record_date');
        }
        if (!db.objectStoreNames.contains('audio_records')) {
          const s = db.createObjectStore('audio_records', { keyPath: 'id' });
          s.createIndex('child_id', 'child_id');
        }
        if (!db.objectStoreNames.contains('audio_blobs')) {
          // 本地离线存储音频 Blob；接入 Supabase 后由 syncService 上传并改写 storage_path
          db.createObjectStore('audio_blobs', { keyPath: 'id' });
        }
      },
    }).catch((e) => {
      unavailable = true;
      throw e;
    });
  }
  return dbPromise;
}

export async function put<T extends StoreName>(store: T, value: Schema[T]): Promise<void> {
  const db = await getDB();
  await db.put(store, value);
}

export async function putMany<T extends StoreName>(store: T, values: Schema[T][]): Promise<void> {
  if (!values.length) return;
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all(values.map((v) => tx.store.put(v)));
  await tx.done;
}

export async function getAll<T extends StoreName>(store: T): Promise<Schema[T][]> {
  const db = await getDB();
  return (await db.getAll(store)) as Schema[T][];
}

export async function get<T extends StoreName>(store: T, id: string): Promise<Schema[T] | undefined> {
  const db = await getDB();
  return (await db.get(store, id)) as Schema[T] | undefined;
}

export async function getByIndex<T extends StoreName>(
  store: T,
  index: string,
  key: IDBValidKey | IDBKeyRange
): Promise<Schema[T][]> {
  const db = await getDB();
  return (await db.getAllFromIndex(store, index, key)) as Schema[T][];
}

export async function remove(store: StoreName, id: string): Promise<void> {
  const db = await getDB();
  await db.delete(store, id);
}

export async function removeMany(store: StoreName, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function clear(store: StoreName): Promise<void> {
  const db = await getDB();
  await db.clear(store);
}

/** 清空本机全部用户数据（设置页「清除本地缓存」） */
export async function wipeLocalData(): Promise<void> {
  const stores: StoreName[] = [
    'children',
    'weekly_reviews',
    'review_items',
    'progress_checkins',
    'assessments',
    'growth_records',
    'audio_records',
  ];
  await Promise.all(stores.map((s) => clear(s)));
}

export const isStorageAvailable = () => !unavailable;
export const uid = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ------------------------------------------------------------------ 音频 Blob

/** 把录音 Blob 存进 IndexedDB（离线优先），key = audio_record.id */
export async function putAudioBlob(id: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('audio_blobs', { id, blob });
}

export async function getAudioBlob(id: string): Promise<Blob | undefined> {
  const db = await getDB();
  const row = (await db.get('audio_blobs', id)) as { id: string; blob: Blob } | undefined;
  return row?.blob;
}

export async function deleteAudioBlob(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('audio_blobs', id);
}

export async function hasAudioBlob(id: string): Promise<boolean> {
  const db = await getDB();
  return (await db.getKey('audio_blobs', id)) !== undefined;
}
