/**
 * 全局状态：当前孩子、孩子列表、同步状态。
 * 只放跨页面共享的少量状态，页面内部状态一律留在页面里。
 *
 * last_selected_child 存 LocalStorage（第 32 节：LocalStorage 只用于轻量设备设置）。
 */
import { create } from 'zustand';
import * as userData from '@/services/userDataService';
import { syncService, type SyncUiState } from '@/services/syncService';
import type { Child } from '@/types/user';

const LAST_CHILD_KEY = 'growth-map.last_child';

interface AppState {
  ready: boolean;
  children: Child[];
  currentChild: Child | null;
  syncState: SyncUiState;
  /** 顶部横幅：数据恢复中（V1.1 校准报告 08） */
  restoring: boolean;

  init: () => Promise<void>;
  refresh: () => Promise<void>;
  selectChild: (id: string) => void;
  signOut: () => void;
  setSyncState: (s: SyncUiState) => void;
  dismissRestoring: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  children: [],
  currentChild: null,
  syncState: 'local',
  restoring: false,

  async init() {
    if (get().ready) return;
    set({ restoring: true });
    const [children] = await Promise.all([
      userData.getChildren(),
      new Promise((r) => setTimeout(r, 900)), // 恢复态至少展示一帧，避免闪屏
    ]);
    const lastId = localStorage.getItem(LAST_CHILD_KEY);
    const current = children.find((c) => c.id === lastId) || children[0] || null;
    set({ children, currentChild: current, ready: true });
    syncService.startAutoSync();
    void syncService.autoInit();
    set({ syncState: syncService.getState() });
    syncService.subscribe((s) => set({ syncState: s }));
    // 恢复完成，进入地图
    setTimeout(() => set({ restoring: false }), 400);
  },

  async refresh() {
    const children = await userData.getChildren();
    const cur = get().currentChild;
    const current = children.find((c) => c.id === cur?.id) || children[0] || null;
    set({ children, currentChild: current });
  },

  selectChild(id: string) {
    const child = get().children.find((c) => c.id === id) || null;
    if (child) localStorage.setItem(LAST_CHILD_KEY, child.id);
    set({ currentChild: child });
  },

  signOut() {
    localStorage.removeItem(LAST_CHILD_KEY);
    set({ currentChild: null });
  },

  setSyncState(s) {
    set({ syncState: s });
  },

  dismissRestoring() {
    set({ restoring: false });
  },
}));

/** 便捷 hook：当前孩子，未创建时为 null */
export const useCurrentChild = () => useAppStore((s) => s.currentChild);
