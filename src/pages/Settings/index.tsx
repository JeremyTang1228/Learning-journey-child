/**
 * Settings —— 设置
 * 原型来源：03_UI_Prototype/Settings.html
 *
 * V1.1 校准报告 Design Change 08：
 *   - 退出登录需二次确认
 *   - 底部展示同步状态（去技术化表达）
 * 数据最小化原则（第 69 节）：不收集学校名称、老师姓名、家庭地址、身份证号。
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import * as userData from '@/services/userDataService';
import { syncService } from '@/services/syncService';
import { useAppStore } from '@/store/appStore';
import { GRADE_ORDER } from '@/utils/status';
import { daysSince } from '@/utils/date';
import { EmptyState, Sheet, SyncBadge, showToast } from '@/components/ui';
import Avatar from '@/components/Avatar';
import styles from './settings.module.css';

/**
 * 把用户选中的照片压缩成正方形 data URL，自动缩到图标尺寸。
 * - 读取为 Image → 居中 cover 裁剪到 size×size → 导出 jpeg；
 * - 默认 160px 足够在大多数屏幕（含 Retina）清晰显示，存储体积仅几 KB；
 * - IndexedDB 里只存这个压缩后的字符串，不存原图，避免撑大本地库。
 */
function compressAvatar(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片加载失败'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('当前环境不支持图片处理'));
          return;
        }
        // 居中 cover 裁剪：取较短边的缩放比，超出部分裁掉
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (size - w) / 2;
        const y = (size - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function Settings() {
  const navigate = useNavigate();
  const child = useAppStore((s) => s.currentChild);
  const children = useAppStore((s) => s.children);
  const refresh = useAppStore((s) => s.refresh);
  const selectChild = useAppStore((s) => s.selectChild);
  const signOut = useAppStore((s) => s.signOut);
  const ready = useAppStore((s) => s.ready);
  const syncState = useAppStore((s) => s.syncState);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [form, setForm] = useState<{ name: string; grade: string; school_year: string; avatar?: string }>({
    name: '',
    grade: '一年级',
    school_year: String(new Date().getFullYear()),
    avatar: '',
  });
  const [confirmExit, setConfirmExit] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 云端同步配置 + 登录态
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteKey, setRemoteKey] = useState('');
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [pwd, setPwd] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authMsg, setAuthMsg] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (child) {
      setForm({ name: child.name, grade: child.grade, school_year: child.school_year, avatar: child.avatar });
    } else {
      setForm({ name: '', grade: '一年级', school_year: String(new Date().getFullYear()), avatar: '' });
    }
  }, [child]);

  // 云端：加载生效配置（内置或覆盖）+ 检查登录态
  useEffect(() => {
    const cfg = syncService.getEffectiveConfig();
    if (cfg) {
      setRemoteUrl(cfg.url);
      setRemoteKey(cfg.builtin ? '' : cfg.anonKey);
    }
    void (async () => {
      const c = syncService.getEffectiveConfig();
      if (!c) return;
      const { initSupabase, currentUserEmail, getSupabase } = await import('@/services/supabaseSync');
      if (!getSupabase()) initSupabase(c.url, c.anonKey);
      setAuthEmail(await currentUserEmail());
    })();
  }, []);

  /** 把用户粘贴的地址归一化为基地址（去掉 /rest/v1/ 等路径与尾部斜杠） */
  function normalizeSupabaseUrl(raw: string): string {
    let u = raw.trim().replace(/\s+/g, '');
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    try {
      return new URL(u).origin;
    } catch {
      return u.replace(/\/+$/, '').replace(/\/rest\/v1\/?$/i, '');
    }
  }

  async function handleSaveRemote() {
    const url = normalizeSupabaseUrl(remoteUrl);
    const key = remoteKey.trim();
    if (!url || !key) {
      showToast('请填写完整的 Project URL 和 Publishable key');
      return;
    }
    setRemoteUrl(url);
    setRemoteKey(key);
    syncService.setConfig({ url, anonKey: key });
    showToast('已保存云端配置，请登录账号');
    const { initSupabase, currentUserEmail, getSupabase } = await import('@/services/supabaseSync');
    if (!getSupabase()) initSupabase(url, key);
    setAuthEmail(await currentUserEmail());
  }

  async function handleLogin() {
    setAuthBusy(true);
    setAuthMsg('');
    try {
      const { initSupabase, signIn, getSupabase } = await import('@/services/supabaseSync');
      const cfg = syncService.getConfig();
      if (cfg && !getSupabase()) initSupabase(cfg.url, cfg.anonKey);
      await signIn(email, pwd);
      setAuthEmail(email);
      showToast('登录成功，开始同步');
      syncService.syncNow();
    } catch (e) {
      setAuthMsg(e instanceof Error ? e.message : '登录失败');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleSignUp() {
    setAuthBusy(true);
    setAuthMsg('');
    try {
      const { initSupabase, signUp, getSupabase } = await import('@/services/supabaseSync');
      const cfg = syncService.getConfig();
      if (cfg && !getSupabase()) initSupabase(cfg.url, cfg.anonKey);
      const activeEmail = await signUp(email, pwd);
      if (activeEmail) {
        setAuthEmail(activeEmail);
        showToast('注册成功，开始同步');
        syncService.syncNow();
      } else {
        setAuthMsg('注册成功！若后台开启了邮箱验证，请先查收邮件完成验证，再回来登录。');
      }
    } catch (e) {
      setAuthMsg(e instanceof Error ? e.message : '注册失败');
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleCloudSignOut() {
    const { signOutAuth } = await import('@/services/supabaseSync');
    await signOutAuth();
    setAuthEmail(null);
    setEmail('');
    setPwd('');
    showToast('已退出云端账号');
  }

  /** 高级：放弃自定义后端，回退到打包内置凭据（或纯本地） */
  function handleResetBackend() {
    syncService.clearConfig();
    const c = syncService.getEffectiveConfig();
    setRemoteUrl(c ? c.url : '');
    setRemoteKey('');
    setShowAdvanced(false);
    showToast('已恢复默认云端配置');
  }

  // 选中照片 → 压缩 → 写入表单并立即保存（已有孩子时）
  async function onPickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许再次选择同一张
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await compressAvatar(file, 160);
      await new Promise<void>((resolve) => {
        setForm((f) => ({ ...f, avatar: dataUrl }));
        resolve();
      });
      if (child) {
        // 已有孩子：上传即保存，避免用户以为没生效
        await save(dataUrl);
      } else {
        showToast('头像预览已更新，填写完信息后点保存');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '图片读取失败，换一张试试');
    } finally {
      setBusy(false);
    }
  }

  /** 当前表单里正在用的头像（编辑时回显已存头像） */
  const formAvatar = form.avatar || child?.avatar || undefined;

  if (!ready) return <div className="page"><EmptyState icon="⏳" title="正在读取设置" /></div>;

  const save = async (avatarOverride?: string) => {
    const payload = { ...form, avatar: avatarOverride || form.avatar || child?.avatar || undefined };
    if (child) {
      await userData.updateChild(child.id, payload);
      await refresh();
      showToast('已保存');
      setEditing(false);
    } else {
      await userData.createChild(payload);
      await refresh();
      showToast('已保存，前往成长地图');
      setCreating(false);
      navigate('/');
    }
  };

  // 全页共用的隐藏文件选择器（设置卡、编辑/新增表单共用）
  const fileInput = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      style={{ display: 'none' }}
      onChange={onPickPhoto}
      aria-hidden="true"
    />
  );

  // 高级：自定义后端折叠区（覆盖内置凭据 / 恢复默认）
  const advancedBlock = (
    <div className="stack-sm" style={{ marginTop: 'var(--sp-sm)' }}>
      <label className="stack-sm">
        <span className="t-meta">Project URL（覆盖）</span>
        <input
          className={styles.input}
          placeholder="https://xxxx.supabase.co"
          value={remoteUrl}
          onChange={(e) => setRemoteUrl(e.target.value)}
        />
      </label>
      <label className="stack-sm">
        <span className="t-meta">Publishable key（覆盖）</span>
        <input
          className={styles.input}
          placeholder="sb_publishable_..."
          value={remoteKey}
          onChange={(e) => setRemoteKey(e.target.value)}
        />
      </label>
      <div className="row" style={{ gap: 'var(--sp-sm)' }}>
        <button className="btn grow" onClick={() => void handleSaveRemote()}>
          覆盖并连接
        </button>
        <button className="btn btn-ghost grow" onClick={handleResetBackend}>
          恢复默认
        </button>
      </div>
      <div className="t-meta">可粘贴带 /rest/v1/ 的完整地址，会自动修正为基地址。</div>
    </div>
  );

  // 云端同步卡片：无论是否已有孩子都显示（模式 A 内置凭据，普通用户直接注册/登录）
  const cloudSyncCard = (
    <section className="card stack-sm">
      <div className="t-sub">云端同步</div>
      {!syncService.isRemoteEnabled() ? (
        <>
          <div className="t-meta">
            当前为「本机模式」：成长数据只保存在这台设备的浏览器里。开启云端后，换设备登录即可恢复。
          </div>
          <label className="stack-sm">
            <span className="t-meta">Project URL</span>
            <input
              className={styles.input}
              placeholder="https://xxxx.supabase.co"
              value={remoteUrl}
              onChange={(e) => setRemoteUrl(e.target.value)}
            />
          </label>
          <label className="stack-sm">
            <span className="t-meta">Publishable key</span>
            <input
              className={styles.input}
              placeholder="sb_publishable_..."
              value={remoteKey}
              onChange={(e) => setRemoteKey(e.target.value)}
            />
          </label>
          <button className="btn btn-primary btn-block" onClick={() => void handleSaveRemote()}>
            保存并连接
          </button>
        </>
      ) : !authEmail ? (
        <>
          <div className="t-meta">已连接云端：{remoteUrl}</div>
          <label className="stack-sm">
            <span className="t-meta">邮箱</span>
            <input
              className={styles.input}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="stack-sm">
            <span className="t-meta">密码</span>
            <input
              className={styles.input}
              type="password"
              placeholder="至少 6 位"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
          </label>
          <div className="row" style={{ gap: 'var(--sp-sm)' }}>
            <button className="btn btn-primary grow" disabled={authBusy} onClick={() => void handleLogin()}>
              登录
            </button>
            <button className="btn grow" disabled={authBusy} onClick={() => void handleSignUp()}>
              注册
            </button>
          </div>
          {authMsg ? <div className="t-meta">{authMsg}</div> : null}
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '收起高级设置 ▴' : '高级：使用自己的 Supabase ▾'}
          </button>
          {showAdvanced ? advancedBlock : null}
        </>
      ) : (
        <>
          <div className="row-between">
            <span className="t-body">云端账号</span>
            <span className="chip on">{authEmail}</span>
          </div>
          <SyncBadge state={syncState} />
          <button className="btn btn-ghost btn-block" onClick={() => void handleCloudSignOut()}>
            退出云端账号
          </button>
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? '收起高级设置 ▴' : '高级：使用自己的 Supabase ▾'}
          </button>
          {showAdvanced ? advancedBlock : null}
        </>
      )}
    </section>
  );

  // 首次设置：还没有任何孩子
  if (!child && !creating) {
    return (
      <div className="page">
        {fileInput}
        <div className="stack">
          <div>
            <div className="t-title">⚙️ 先来认识一下孩子吧</div>
            <div className="t-meta">填好基本信息，成长地图就会为 TA 打开</div>
          </div>
          <div className="card stack">
            <label className="stack-sm">
              <span className="t-meta">孩子的名字</span>
              <input
                className={styles.input}
                placeholder="比如：明明"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="stack-sm">
              <span className="t-meta">当前年级</span>
              <div className={styles.gradeGrid}>
                {GRADE_ORDER.map((g) => (
                  <button
                    key={g}
                    className={`chip${form.grade === g ? ' on' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, grade: g }))}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </label>
            <label className="stack-sm">
              <span className="t-meta">入学年份</span>
              <input
                className={styles.input}
                value={form.school_year}
                inputMode="numeric"
                onChange={(e) => setForm((f) => ({ ...f, school_year: e.target.value }))}
              />
            </label>
          </div>
          <button className="btn btn-primary btn-lg btn-block" onClick={() => void save()}>
            保存，开始旅程 🗺️
          </button>
          {cloudSyncCard}
        </div>
      </div>
    );
  }

  const walked = daysSince(`${child?.school_year ?? ''}-09-01`);

  return (
    <div className="page">
      {fileInput}
      <div className="t-title" style={{ marginBottom: 'var(--sp-lg)' }}>
        ⚙️ 设置
      </div>

      <div className="stack">
        {/* 孩子信息 */}
        <section className="card stack-sm">
          <div className="row" style={{ gap: 'var(--sp-md)' }}>
            <button
              type="button"
              className={styles.avatarBtn}
              onClick={() => fileRef.current?.click()}
              aria-label="更换头像"
            >
              <Avatar value={formAvatar} size={52} />
            </button>
            <div className="grow">
              <div className="t-sub">{child?.name}</div>
              <div className="t-meta">
                {child?.grade} · {child?.school_year} 年入学
              </div>
              {walked > 0 ? <div className="t-meta">已经在小学路上走了 {walked} 天</div> : null}
            </div>
          </div>
          <div className="row" style={{ gap: 'var(--sp-sm)' }}>
            <button className="btn grow" onClick={() => setEditing(true)}>
              编辑孩子信息
            </button>
            {children.length > 1 ? (
              <button className="btn grow" onClick={() => setSwitching(true)}>
                切换孩子
              </button>
            ) : null}
          </div>
          <button className="btn btn-ghost grow" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? '处理中…' : '📷 上传小朋友的照片做头像'}
          </button>
        </section>

        {/* 提醒 */}
        <section className="card stack-sm">
          <div className="t-sub">提醒设置</div>
          <div className="row-between">
            <span className="t-body">每周复盘提醒</span>
            <span className="chip mute">每周五 18:00</span>
          </div>
          <div className="t-meta">提醒能力将在后续版本开放，到时可在手机上直接收到。</div>
        </section>

        {/* 数据与隐私 */}
        <section className="card stack-sm">
          <div className="t-sub">数据与隐私</div>
          <div className="row-between">
            <span className="t-body">成长数据</span>
            <SyncBadge state={syncState} />
          </div>
          <div className="t-meta">
            {syncService.isRemoteEnabled()
              ? '已连接云端，换设备登录后可以恢复完整成长地图。'
              : '目前保存在这台设备上。填入云端配置后，换设备登录即可恢复完整成长地图。'}
          </div>
        </section>

        {/* 云端同步 */}
        {cloudSyncCard}

        {/* 关于 */}
        <section className="card stack-sm">
          <div className="row-between">
            <span className="t-body">版本</span>
            <span className="t-meta">知识成长地图 v1.0.0</span>
          </div>
          <div className="row-between">
            <span className="t-body">内容版本</span>
            <span className="t-meta">content 1.0</span>
          </div>
        </section>

        <button className="btn btn-danger btn-block" onClick={() => setConfirmExit(true)}>
          退出登录
        </button>
      </div>

      {/* 编辑 */}
      <Sheet open={editing} onClose={() => setEditing(false)}>
        <div className="stack">
          <div className="t-sub">编辑孩子信息</div>
          {/* 头像：上传照片 / 选表情，二选一 */}
          <div className="stack-sm">
            <span className="t-meta">头像</span>
            <div className="row" style={{ gap: 'var(--sp-md)' }}>
              <Avatar value={formAvatar} size={56} />
              <div className="grow stack-sm">
                <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  {busy ? '处理中…' : '📷 上传照片'}
                </button>
                <span className="t-meta">上传后会自动裁成正方形、缩到图标大小</span>
              </div>
            </div>
            <div className={styles.emojiRow}>
              {userData.AVATARS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`${styles.emojiBtn}${formAvatar === e ? ' ' + styles.on : ''}`}
                  onClick={() => setForm((f) => ({ ...f, avatar: e }))}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <label className="stack-sm">
            <span className="t-meta">名字</span>
            <input className={styles.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <div className="stack-sm">
            <span className="t-meta">年级</span>
            <div className={styles.gradeGrid}>
              {GRADE_ORDER.map((g) => (
                <button key={g} className={`chip${form.grade === g ? ' on' : ''}`} onClick={() => setForm((f) => ({ ...f, grade: g }))}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-block" onClick={() => void save()}>
            保存
          </button>
        </div>
      </Sheet>

      {/* 切换孩子 */}
      <Sheet open={switching} onClose={() => setSwitching(false)}>
        <div className="stack">
          <div className="t-sub">切换到其他孩子</div>
          {children.map((c) => (
            <button
              key={c.id}
              className="card row"
              onClick={() => {
                selectChild(c.id);
                setSwitching(false);
              }}
            >
              <Avatar value={c.avatar} size={28} />
              <span className="grow t-body">{c.name}</span>
              <span className="t-meta">{c.grade}</span>
            </button>
          ))}
          <button
            className="btn btn-block"
            onClick={() => {
              setSwitching(false);
              setCreating(true);
              setForm({ name: '', grade: '一年级', school_year: String(new Date().getFullYear()) });
            }}
          >
            ＋ 添加另一个孩子
          </button>
        </div>
      </Sheet>

      {/* 新增孩子 */}
      <Sheet open={creating} onClose={() => setCreating(false)}>
        <div className="stack">
          <div className="t-sub">添加孩子</div>
          {/* 头像：上传照片 / 选表情 */}
          <div className="stack-sm">
            <span className="t-meta">头像</span>
            <div className="row" style={{ gap: 'var(--sp-md)' }}>
              <Avatar value={formAvatar} size={56} />
              <div className="grow stack-sm">
                <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                  {busy ? '处理中…' : '📷 上传照片'}
                </button>
                <span className="t-meta">上传后会自动裁成正方形、缩到图标大小</span>
              </div>
            </div>
            <div className={styles.emojiRow}>
              {userData.AVATARS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`${styles.emojiBtn}${formAvatar === e ? ' ' + styles.on : ''}`}
                  onClick={() => setForm((f) => ({ ...f, avatar: e }))}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <label className="stack-sm">
            <span className="t-meta">名字</span>
            <input className={styles.input} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </label>
          <div className="stack-sm">
            <span className="t-meta">年级</span>
            <div className={styles.gradeGrid}>
              {GRADE_ORDER.map((g) => (
                <button key={g} className={`chip${form.grade === g ? ' on' : ''}`} onClick={() => setForm((f) => ({ ...f, grade: g }))}>
                  {g}
                </button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-block" onClick={() => void save()}>
            保存
          </button>
        </div>
      </Sheet>

      {/* 退出确认 */}
      <Sheet open={confirmExit} onClose={() => setConfirmExit(false)}>
        <div className="stack">
          <div className="t-sub">确认退出登录？</div>
          <div className="t-meta">成长数据仍保留在这台设备上，下次打开可以继续记录。</div>
          <button
            className="btn btn-danger btn-block"
            onClick={() => {
              setConfirmExit(false);
              signOut();
              showToast('已退出登录');
              navigate('/settings', { replace: true });
            }}
          >
            确认退出
          </button>
          <button className="btn btn-block" onClick={() => setConfirmExit(false)}>
            再想想
          </button>
        </div>
      </Sheet>
    </div>
  );
}
