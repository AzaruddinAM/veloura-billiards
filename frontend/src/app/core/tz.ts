/** Date/time helpers pinned to the venue's timezone (not the visitor's device). */

export function ymd(ts: number, tz: string): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ts * 1000);
}

/** 24h "HH:MM" — what the API expects. */
export function hm24(ts: number, tz: string): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ts * 1000);
  return `${p.find((x) => x.type === 'hour')!.value}:${p.find((x) => x.type === 'minute')!.value}`;
}

/** Friendly time, e.g. "7:30 PM". */
export function timeLabel(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(ts * 1000).toUpperCase();
}

/** e.g. "Sat, 22 Nov" */
export function dayLabel(ts: number, tz: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(ts * 1000);
}

/** The next `days` calendar days in the venue timezone, starting today. Noon avoids DST edges. */
export function upcomingDays(nowTs: number, days: number, tz: string): { ymd: string; ts: number }[] {
  const out: { ymd: string; ts: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < days && i < days + 3; i++) {
    const ts = nowTs + i * 86400;
    const d = ymd(ts, tz);
    if (!seen.has(d)) { seen.add(d); out.push({ ymd: d, ts }); }
  }
  return out;
}

export function durationLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return h && m ? `${h}h ${m}m` : h ? `${h} hr${h > 1 ? 's' : ''}` : `${m} min`;
}
