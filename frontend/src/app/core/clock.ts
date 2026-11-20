import { Injectable, signal } from '@angular/core';
import { Settings } from './models';

/** A ticking clock aligned to the server's time, so timers agree across devices. */
@Injectable({ providedIn: 'root' })
export class Clock {
  private offset = 0;
  readonly now = signal(Date.now() / 1000);

  constructor() {
    setInterval(() => this.now.set(Date.now() / 1000 + this.offset), 250);
  }

  sync(serverTime: number): void {
    this.offset = serverTime - Date.now() / 1000;
    this.now.set(serverTime);
  }
}

/** Mirrors the PHP Billing::compute rules for a live estimate. */
export function estimateBill(startTs: number, endTs: number, rate: number, s: Settings) {
  const seconds = Math.max(0, endTs - startTs);
  const minutes = Math.ceil(seconds / 60);
  const round = Math.max(1, s.round_to_minutes);
  const billed = Math.max(Math.ceil(minutes / round) * round, s.min_minutes);
  return { minutes, billed, amount: Math.round(rate * billed / 60 * 100) / 100 };
}

export function hms(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join(':');
}

export function minutesLabel(min: number | null | undefined): string {
  const m = min ?? 0;
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function previousPeriod(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function periodLabel(p: string): string {
  const [y, m] = p.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}
