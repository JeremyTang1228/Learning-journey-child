/**
 * Sync Service —— IndexedDB ⇄ 云端的唯一同步通道。
 *
 * 开发总 Prompt 第 34、62 节：页面绝不直接操作同步逻辑。
 *
 * 当前为「本地优先」模式：未配置 Supabase 凭据时，所有数据完整落在本机 IndexedDB，
 * 功能 100% 可用，对外只显示「已保存到本机」。填入凭据后，
 * syncService 会把本机已有数据全量推送到云端，页面与业务逻辑零改动。
 *
 * 同步状态对外只有四种表达（V1.1 原则 14，禁止暴露技术术语）：
 *   已保存到本机 / 正在同步 / 已同步 / 暂时无法同步
 */

import { getAllPending } from './userDataService';

export type SyncUiState = 'local' | 'syncing' | 'synced' | 'failed';

interface RemoteConfig {
  url: string;
  anonKey: string;
}

/** 生效配置：在「用户覆盖」与「内置凭据」之上派生 */
interface EffectiveConfig extends RemoteConfig {
  /** true = 来自打包内置（VITE_ 环境变量），用户未手动覆盖 */
  builtin: boolean;
}

const CONFIG_KEY = 'growth-map.remote-config';

/**
 * 模式 A：打包内置凭据（Vite 在构建期把 .env 的 VITE_ 变量注入前端）。
 * publishable / anon key 设计上可公开嵌前端，靠 RLS 保护数据，无泄露风险。
 * 留空则 App 进入纯本地模式（数据仅存浏览器 IndexedDB）。
 */
const BUILTIN_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const BUILTIN_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

const RETRY_DELAYS = [1000, 5000, 30000, 120000, 600000];

type Listener = (s: SyncUiState) => void;

class SyncService {
  private state: SyncUiState = 'local';
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private retryCount = 0;
  private lastSyncAt: number | null = null;
  private pendingCount = 0;

  // ------------------------------------------------------------ 配置

  /** 从 localStorage 读取云端配置（轻量设备设置，符合第 32 节） */
  getConfig(): RemoteConfig | null {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      const c = JSON.parse(raw) as Partial<RemoteConfig>;
      return c.url && c.anonKey ? { url: c.url, anonKey: c.anonKey } : null;
    } catch {
      return null;
    }
  }

  setConfig(c: RemoteConfig) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    this.retryCount = 0;
    void this.bootstrapRemote();
  }

  /** 配置就绪：初始化客户端 → 新设备先拉取恢复 → 再推送 */
  private async bootstrapRemote() {
    const cfg = this.getEffectiveConfig();
    if (!cfg) return;
    const { initSupabase, pullAll } = await import('./supabaseSync');
    initSupabase(cfg.url, cfg.anonKey);
    try {
      await pullAll();
    } catch {
      // 拉取失败不阻塞后续推送；syncNow 会继续尝试
    }
    await this.syncNow();
  }

  clearConfig() {
    localStorage.removeItem(CONFIG_KEY);
    void import('./supabaseSync').then((m) => m.resetSupabase());
    this.setState('local');
  }

  // ------------------------------------------------------------ 配置（含内置凭据）

  /**
   * 生效配置：用户手动覆盖（localStorage）优先；否则回退打包内置凭据；都没有返回 null。
   * 这是全链路唯一应读取的"当前该用哪个后端"入口。
   */
  getEffectiveConfig(): EffectiveConfig | null {
    const stored = this.getConfig();
    if (stored) return { ...stored, builtin: false };
    if (BUILTIN_URL && BUILTIN_KEY) return { url: BUILTIN_URL, anonKey: BUILTIN_KEY, builtin: true };
    return null;
  }

  /** 是否接入了云端（内置或覆盖均可） */
  isRemoteEnabled() {
    return this.getEffectiveConfig() !== null;
  }

  /**
   * 应用启动即调用：用生效配置初始化客户端；若已有登录会话（persistSession 跨刷新保留），
   * 静默拉取恢复 + 推送本地改动。用户无感，无需任何手动配置。
   */
  async autoInit() {
    const cfg = this.getEffectiveConfig();
    if (!cfg) return;
    const { initSupabase, getSupabase, currentUserEmail, pullAll } = await import('./supabaseSync');
    if (!getSupabase()) initSupabase(cfg.url, cfg.anonKey);
    try {
      if (await currentUserEmail()) {
        await pullAll();
        void this.syncNow();
      }
    } catch {
      // 拉取失败不影响本机使用；syncNow 的定时重试会继续
    }
  }

  // ------------------------------------------------------------ 状态

  getState() {
    return this.state;
  }

  getUiText(): string {
    switch (this.state) {
      case 'local':
        return '已保存到本机';
      case 'syncing':
        return '正在同步';
      case 'synced':
        return '已同步';
      case 'failed':
        return '暂时无法同步，稍后会自动重试';
    }
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: SyncUiState) {
    if (this.state === s) return;
    this.state = s;
    this.listeners.forEach((l) => l(s));
  }

  /** 根据实际配置与联网情况推导对外状态 */
  private evaluate() {
    if (!this.isRemoteEnabled()) return this.setState('local');
    if (this.running) return this.setState('syncing');
    if (this.retryCount > 0) return this.setState('failed');
    if (this.pendingCount > 0) return this.setState('syncing');
    return this.setState(this.lastSyncAt ? 'synced' : 'local');
  }

  // ------------------------------------------------------------ 同步执行

  async syncNow(): Promise<void> {
    if (this.running) return;
    if (!this.isRemoteEnabled()) {
      this.setState('local');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState('failed');
      return;
    }

    this.running = true;
    this.setState('syncing');
    try {
      const pending = await getAllPending();
      this.pendingCount = Object.values(pending).reduce((n, rows) => n + rows.length, 0);

      if (this.pendingCount === 0) {
        this.lastSyncAt = Date.now();
        this.retryCount = 0;
        this.running = false;
        return this.evaluate();
      }

      // 调用云端适配器（按需懒加载，未配置远端时不进主包）
      const { getSupabase, initSupabase, pushAll } = await import('./supabaseSync');
      const cfg = this.getEffectiveConfig();
      if (!getSupabase() && cfg) initSupabase(cfg.url, cfg.anonKey);
      await pushAll();
    } catch {
      this.running = false;
      this.retryCount = Math.min(this.retryCount + 1, RETRY_DELAYS.length);
      this.setState('failed');
      const delay = RETRY_DELAYS[this.retryCount - 1] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
      setTimeout(() => void this.syncNow(), delay);
    }
  }

  /** 应用启动时调用：联网恢复 / 定时重试 */
  startAutoSync() {
    if (this.timer) return;
    this.evaluate();
    this.timer = setInterval(() => void this.syncNow(), 60000);
    window.addEventListener('online', () => {
      this.retryCount = 0;
      void this.syncNow();
    });
    window.addEventListener('offline', () => this.evaluate());
  }

  stopAutoSync() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 设置页展示「最近同步于 X 分钟前」 */
  lastSyncedMinutesAgo(): number | null {
    return this.lastSyncAt ? Math.floor((Date.now() - this.lastSyncAt) / 60000) : null;
  }
}

export const syncService = new SyncService();
