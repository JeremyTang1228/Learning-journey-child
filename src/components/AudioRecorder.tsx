/**
 * AudioRecorder —— 「🎙️ 讲给我听」录音组件。
 *
 * 定位（开发总 Prompt 第 30 节）：录音是成长记录，不是课程作业。
 * 离线优先：MediaRecorder 采集 → Blob 存 IndexedDB（audio_blobs）→
 * 生成 audio_record（storage_path = local:<id>）+ 一条 audio 成长记录。
 * 接入 Supabase 后由 syncService 上传并改写 storage_path。
 *
 * 四种状态齐全：
 *   - 不支持（无 MediaRecorder / 无麦克风）
 *   - 权限被拒
 *   - 录音中（计时）
 *   - 已录好（试听 / 保存 / 重录）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import * as db from '@/services/storageService';
import * as userData from '@/services/userDataService';
import { showToast } from '@/components/ui';
import type { AudioRecord } from '@/types/user';
import styles from './audio.module.css';

type Phase = 'idle' | 'recording' | 'review' | 'saving' | 'unsupported' | 'denied';

interface ExistingRec extends AudioRecord {
  url?: string;
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function AudioRecorder({
  childId,
  knowledgeId,
}: {
  childId: string;
  knowledgeId: string | null;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [existing, setExisting] = useState<ExistingRec[]>([]);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const supported =
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;

  // ---------------------------------------------------------------- 载入已有录音
  const loadExisting = useCallback(async () => {
    const recs = await userData.getAudioRecords(childId, knowledgeId ?? undefined);
    const withUrls = await Promise.all(
      recs.map(async (r) => {
        const blob = await db.getAudioBlob(r.id);
        return blob ? { ...r, url: URL.createObjectURL(blob) } : r;
      })
    );
    setExisting(withUrls);
  }, [childId, knowledgeId]);

  useEffect(() => {
    void loadExisting();
    return () => {
      existing.forEach((r) => r.url && URL.revokeObjectURL(r.url));
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childId, knowledgeId]);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const cleanupStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // ---------------------------------------------------------------- 开始录音
  const start = async () => {
    if (!supported) {
      setPhase('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      rec.onstop = () => {
        cleanupStream();
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = URL.createObjectURL(blob);
        pendingBlobRef.current = blob;
        setPhase('review');
      };
      rec.start();
      setElapsed(0);
      setPhase('recording');
      stopTimer();
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch (err) {
      cleanupStream();
      const name = (err as DOMException)?.name;
      setPhase(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unsupported');
    }
  };

  const pendingBlobRef = useRef<Blob | null>(null);

  // ---------------------------------------------------------------- 停止录音
  const stop = () => {
    stopTimer();
    recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop();
  };

  // ---------------------------------------------------------------- 保存
  const save = async () => {
    const blob = pendingBlobRef.current;
    if (!blob) return;
      setSaving(true);
      const id = db.uid('au');
      await db.putAudioBlob(id, blob);
      await userData.createAudioRecord({
        child_id: childId,
        knowledge_id: knowledgeId,
        storage_path: `local:${id}`,
        duration: elapsed,
      });
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      pendingBlobRef.current = null;
      setSaving(false);
      setPhase('idle');
      setElapsed(0);
      showToast('录音已留下 🎙️');
      void loadExisting();
  };

  const discard = () => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    pendingBlobRef.current = null;
    setPhase('idle');
    setElapsed(0);
  };

  const togglePlay = (rec: ExistingRec) => {
    if (!rec.url) return;
    if (playingId === rec.id) {
      audioElRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioElRef.current) {
      audioElRef.current.pause();
    }
    const el = new Audio(rec.url);
    audioElRef.current = el;
    el.onended = () => setPlayingId(null);
    void el.play();
    setPlayingId(rec.id);
  };

  // ---------------------------------------------------------------- 渲染

  return (
    <div className={styles.wrap}>
      <div className="t-meta" style={{ marginBottom: 8 }}>
        🎙️ 讲给我听
      </div>

      {!supported && phase !== 'denied' ? (
        <div className={styles.note}>当前浏览器不支持录音，可以用手机打开这个功能～</div>
      ) : null}

      {phase === 'denied' ? (
        <div className={styles.note}>麦克风权限被拒绝了，在浏览器设置里打开就能录啦</div>
      ) : null}

      {phase === 'idle' ? (
        <div className="stack-sm">
          <button className={styles.recBtn} onClick={() => void start()} disabled={!supported}>
            <span className={styles.recDot} /> 开始一段讲解
          </button>
          {existing.length > 0 ? <RecordList recs={existing} playingId={playingId} onPlay={togglePlay} /> : null}
        </div>
      ) : null}

      {phase === 'recording' ? (
        <div className={styles.live}>
          <span className={styles.recDotLive} />
          <span className={styles.timer}>录音中 · {fmt(elapsed)}</span>
          <button className={styles.stopBtn} onClick={stop}>
            ■ 停止
          </button>
        </div>
      ) : null}

      {phase === 'review' ? (
        <div className={styles.review}>
          <audio src={previewUrlRef.current ?? ''} controls className={styles.audio} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn grow" onClick={discard}>
              重录
            </button>
            <button className="btn btn-primary grow" onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : '保存这段'}
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'saving' ? (
        <div className={styles.note}>正在保存…</div>
      ) : null}
    </div>
  );
}

function RecordList({
  recs,
  playingId,
  onPlay,
}: {
  recs: ExistingRec[];
  playingId: string | null;
  onPlay: (r: ExistingRec) => void;
}) {
  return (
    <div className="stack-sm" style={{ marginTop: 8 }}>
      {recs.map((r) => (
        <div key={r.id} className={styles.item}>
          <button className={styles.playBtn} onClick={() => onPlay(r)} disabled={!r.url} aria-label="播放">
            {playingId === r.id ? '⏸' : '▶'}
          </button>
          <span className="grow t-body" style={{ fontSize: 13 }}>
            {Math.round(r.duration)} 秒的讲解
          </span>
          <span className="t-meta">{new Date(r.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</span>
        </div>
      ))}
    </div>
  );
}
