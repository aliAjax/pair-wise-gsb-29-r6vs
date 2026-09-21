// 纯时间工具：界面与判定共用，不依赖任何业务数据。

export function toLocalDatetimeInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function toIsoFromLocalInput(local: string): string {
  return new Date(local).toISOString();
}

/** HH:mm -> 当天 0 点起的分钟数，非法返回 null */
export function toMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 到站滞留分钟数（当前时刻 - 到站时刻），负数显示为 0 */
export function dwellMinutes(arrivedAt: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(arrivedAt).getTime()) / 60000));
}

export function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
