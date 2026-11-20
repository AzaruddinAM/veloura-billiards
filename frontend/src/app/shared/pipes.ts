import { inject, Pipe, PipeTransform } from '@angular/core';
import { Auth } from '../core/auth';
import { minutesLabel, periodLabel } from '../core/clock';

@Pipe({ name: 'money', pure: false })
export class MoneyPipe implements PipeTransform {
  private auth = inject(Auth);
  transform(v: number | null | undefined, decimals = 0): string {
    const n = Number(v ?? 0);
    const fixed = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: 2 });
    return `${n < 0 ? '−' : ''}${this.auth.settings().currency}${fixed}`;
  }
}

@Pipe({ name: 'mins' })
export class MinutesPipe implements PipeTransform {
  transform(v: number | null | undefined): string { return minutesLabel(v); }
}

@Pipe({ name: 'ts' })
export class TimestampPipe implements PipeTransform {
  transform(v: number | null | undefined, mode: 'datetime' | 'date' | 'time' = 'datetime'): string {
    if (!v) return '—';
    const d = new Date(v * 1000);
    if (mode === 'date') return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    if (mode === 'time') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}

@Pipe({ name: 'period' })
export class PeriodPipe implements PipeTransform {
  transform(v: string | null | undefined): string { return v ? periodLabel(v) : ''; }
}
