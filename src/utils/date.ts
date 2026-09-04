/** 周计算工具。产品以周为单位运转，所有周均以「周一」为起点。 */

export interface WeekRange {
  /** ISO 日期，周一 */
  week_start: string;
  /** ISO 日期，周日 */
  week_end: string;
  week_no: number;
  week_start_date: Date;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** ISO 8601 周序号（周一为一周之始，含每年第一个周四的那一周为第 1 周） */
export function isoWeekNumber(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** 取所在周的周一 00:00 */
export function startOfWeek(d: Date = new Date()): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = r.getDay() || 7;
  r.setDate(r.getDate() - (day - 1));
  return r;
}

export function weekRange(d: Date = new Date()): WeekRange {
  const mon = startOfWeek(d);
  const sun = new Date(mon);
  sun.setDate(sun.getDate() + 6);
  return {
    week_start: toISO(mon),
    week_end: toISO(sun),
    week_no: isoWeekNumber(mon),
    week_start_date: mon,
  };
}

export function addWeeks(isoMonday: string, n: number): WeekRange {
  const d = fromISO(isoMonday);
  d.setDate(d.getDate() + n * 7);
  return weekRange(d);
}

/** 3月17日 */
export function fmtMonthDay(iso: string): string {
  const d = fromISO(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 3月17日～3月21日 */
export function fmtWeekRange(start: string, end: string): string {
  return `${fmtMonthDay(start)}～${fmtMonthDay(end)}`;
}

export function todayISO(): string {
  return toISO(new Date());
}

/** 距今多少天（用于「已经在小学路上走了 N 天」） */
export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0;
  const diff = Date.now() - fromISO(iso).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

export function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  if (h < 6) return '还早呀';
  if (h < 11) return '早呀';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** 最近 N 个可选周（含本周），用于「补录之前的复盘」 */
export function recentWeeks(n = 6): WeekRange[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - 7 * i);
    return weekRange(d);
  });
}
