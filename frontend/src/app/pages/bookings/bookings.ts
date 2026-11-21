import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { Availability, Booking, BookingStatus, PoolTable } from '../../core/models';
import { Toast } from '../../core/toast';
import { dayLabel, durationLabel, hm24, timeLabel, upcomingDays, ymd } from '../../core/tz';

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending', confirmed: 'Confirmed', seated: 'Seated', completed: 'Completed', cancelled: 'Cancelled', no_show: 'No-show',
};

interface NewBooking { table_id: number | null; date: string; time: string; duration_minutes: number; customer_name: string; phone: string; players: number; notes: string; }

@Component({
  selector: 'app-bookings',
  imports: [FormsModule],
  templateUrl: './bookings.html',
  styleUrl: './bookings.scss',
})
export class BookingsPage implements OnInit, OnDestroy {
  private api = inject(Api);
  private toast = inject(Toast);
  private router = inject(Router);
  protected auth = inject(Auth);

  protected view = signal<'day' | 'upcoming'>('day');
  protected date = signal('');
  protected rows = signal<Booking[]>([]);
  protected upcoming = signal<Booking[]>([]);
  protected avail = signal<Availability | null>(null);
  protected selected = signal<Booking | null>(null);
  protected busyId = signal<number | null>(null);
  protected draft = signal<NewBooking | null>(null);
  protected draftAvail = signal<Availability | null>(null);
  protected hideClosed = signal(true);

  protected readonly durations = [30, 60, 90, 120, 150, 180, 240];
  protected readonly durationLabel = durationLabel;
  private poll?: ReturnType<typeof setInterval>;

  protected tz = computed(() => this.auth.settings().timezone ?? 'Asia/Kolkata');
  protected visible = computed(() => this.rows().filter((b) => !this.hideClosed() || !['cancelled', 'no_show'].includes(b.status)));
  protected stats = computed(() => {
    const r = this.rows();
    const c = (s: BookingStatus) => r.filter((b) => b.status === s).length;
    return { total: r.filter((b) => b.status !== 'cancelled').length, pending: c('pending'), confirmed: c('confirmed'), seated: c('seated') + c('completed') };
  });
  /** Timeline geometry for the day view. */
  protected hours = computed(() => {
    const a = this.avail();
    if (!a) return [];
    const out: { ts: number; left: number; label: string }[] = [];
    // First whole hour in the venue's timezone (India is UTC+5:30, so UTC hours would land on :30)
    const min = Number(hm24(a.open_ts, this.tz()).split(':')[1]);
    const first = a.open_ts + (min ? (60 - min) * 60 : 0);
    for (let ts = first; ts <= a.close_ts; ts += 3600) out.push({ ts, left: this.pct(ts), label: timeLabel(ts, this.tz()).replace(':00', '') });
    return out;
  });
  protected lanes = computed(() => {
    const a = this.avail();
    if (!a) return [];
    return a.tables.map((t) => ({
      ...t,
      blocks: this.visible().filter((b) => b.table_id === t.id).map((b) => ({
        b, left: this.pct(Math.max(b.start_ts, a.open_ts)), width: Math.max(1.5, this.pct(Math.min(b.end_ts, a.close_ts)) - this.pct(Math.max(b.start_ts, a.open_ts))),
      })),
    }));
  });
  protected nowLeft = computed(() => {
    const a = this.avail(), now = Date.now() / 1000;
    return a && now >= a.open_ts && now <= a.close_ts ? this.pct(now) : null;
  });
  protected upcomingByDay = computed(() => {
    const groups = new Map<string, { label: string; items: Booking[] }>();
    for (const b of this.upcoming()) {
      const k = ymd(b.start_ts, this.tz());
      if (!groups.has(k)) groups.set(k, { label: dayLabel(b.start_ts, this.tz()), items: [] });
      groups.get(k)!.items.push(b);
    }
    return [...groups.values()];
  });
  protected days = computed(() => upcomingDays(Date.now() / 1000, this.auth.settings().booking_max_days, this.tz()));

  /** Start-time options for the new-booking form (free for the chosen table & duration). */
  protected draftTimes = computed(() => {
    const d = this.draft(), a = this.draftAvail();
    if (!d || !a || !d.table_id) return [];
    const t = a.tables.find((x) => x.id === d.table_id);
    const step = a.slot_minutes * 60, len = d.duration_minutes * 60, now = Date.now() / 1000;
    const out: { value: string; label: string; free: boolean }[] = [];
    for (let ts = a.open_ts; ts + len <= a.close_ts; ts += step) {
      if (ts + len <= now) continue;
      const free = !(t?.busy ?? []).some(([s, e]) => s < ts + len && e > ts);
      out.push({ value: hm24(ts, this.tz()), label: timeLabel(ts, this.tz()), free });
    }
    return out;
  });

  async ngOnInit() {
    this.date.set(ymd(Date.now() / 1000, this.tz()));
    await this.load();
    this.poll = setInterval(() => this.load(true), 30000);
  }

  ngOnDestroy() {
    clearInterval(this.poll);
  }

  async load(quiet = false) {
    try {
      if (this.view() === 'day') {
        const [rows, avail] = await Promise.all([
          this.api.get<Booking[]>('/bookings', { date: this.date() }),
          this.api.get<Availability>('/public/availability', { date: this.date() }),
        ]);
        this.rows.set(rows);
        this.avail.set(avail);
      } else {
        this.upcoming.set(await this.api.get<Booking[]>('/bookings/upcoming'));
      }
      const sel = this.selected();
      if (sel) this.selected.set([...this.rows(), ...this.upcoming()].find((b) => b.id === sel.id) ?? null);
    } catch (e) {
      if (!quiet) throw e;
    }
  }

  setView(v: 'day' | 'upcoming') {
    this.view.set(v);
    this.load();
  }

  shift(days: number) {
    const [y, m, d] = this.date().split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + days, 12));
    this.date.set(dt.toISOString().slice(0, 10));
    this.load();
  }

  today() {
    this.date.set(ymd(Date.now() / 1000, this.tz()));
    this.load();
  }

  async setStatus(b: Booking, status: BookingStatus) {
    const verbs: Partial<Record<BookingStatus, string>> = { cancelled: 'Cancel', no_show: 'Mark as no-show' };
    if (verbs[status] && !confirm(`${verbs[status]} booking ${b.code} for ${b.customer_name}?`)) return;
    this.busyId.set(b.id);
    try {
      await this.api.put(`/bookings/${b.id}/status`, { status });
      this.toast.ok(`${b.customer_name} · ${STATUS_LABEL[status]}`);
      await this.load();
    } finally {
      this.busyId.set(null);
    }
  }

  async seat(b: Booking) {
    this.busyId.set(b.id);
    try {
      await this.api.post(`/bookings/${b.id}/start`);
      this.toast.ok(`${b.table_name} started for ${b.customer_name}`);
      this.selected.set(null);
      this.router.navigate(['/'], { queryParams: { table: b.table_id } });
    } finally {
      this.busyId.set(null);
    }
  }

  // ----- new booking -----
  async newBooking(tableId?: number, ts?: number) {
    const a = this.avail();
    this.draft.set({
      table_id: tableId ?? a?.tables[0]?.id ?? null, date: this.date(), time: ts ? hm24(ts, this.tz()) : '',
      duration_minutes: 60, customer_name: '', phone: '', players: 2, notes: '',
    });
    await this.loadDraftAvail();
  }

  patchDraft(p: Partial<NewBooking>) {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
    if (p.date) this.loadDraftAvail();
  }

  private async loadDraftAvail() {
    const d = this.draft();
    if (d) this.draftAvail.set(await this.api.get<Availability>('/public/availability', { date: d.date }));
  }

  async saveDraft() {
    const d = this.draft();
    if (!d) return;
    await this.api.post<Booking>('/bookings', d);
    this.toast.ok(`Booked ${d.customer_name}`);
    this.draft.set(null);
    if (this.view() === 'day' && d.date !== this.date()) this.date.set(d.date);
    await this.load();
  }

  /** Click on an empty part of a lane → new booking at that time (rounded to the slot). */
  laneClick(ev: MouseEvent, tableId: number) {
    const a = this.avail();
    if (!a || (ev.target as HTMLElement).closest('.block')) return;
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const frac = (ev.clientX - rect.left) / rect.width;
    const step = a.slot_minutes * 60;
    const ts = a.open_ts + Math.floor((frac * (a.close_ts - a.open_ts)) / step) * step;
    this.newBooking(tableId, ts);
  }

  private pct(ts: number) {
    const a = this.avail()!;
    return ((ts - a.open_ts) / (a.close_ts - a.open_ts)) * 100;
  }

  dayTitle() {
    const [y, m, d] = this.date().split('-').map(Number);
    const ts = Date.UTC(y, m - 1, d, 6, 30) / 1000;
    const isToday = this.date() === ymd(Date.now() / 1000, this.tz());
    return (isToday ? 'Today · ' : '') + dayLabel(ts, this.tz());
  }

  t(ts: number) { return timeLabel(ts, this.tz()); }
  statusLabel(s: BookingStatus) { return STATUS_LABEL[s]; }
  canAct(b: Booking) { return b.status === 'pending' || b.status === 'confirmed'; }
  isPast(b: Booking) { return b.end_ts < Date.now() / 1000; }
  money(v?: number) { return `${this.auth.settings().currency}${Math.round(v ?? 0).toLocaleString('en-IN')}`; }
}
