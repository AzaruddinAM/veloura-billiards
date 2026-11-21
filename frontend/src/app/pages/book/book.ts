import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Availability, PublicBooking, PublicInfo, TableType } from '../../core/models';
import { dayLabel, durationLabel, hm24, timeLabel, upcomingDays } from '../../core/tz';
import { Logo } from '../../shared/logo';

export const GAMES: { type: TableType; name: string; blurb: string; color: string }[] = [
  { type: 'pool', name: 'Pool', blurb: '8-ball on tournament cloth', color: '#18a065' },
  { type: 'snooker', name: 'Snooker', blurb: 'Full-size championship tables', color: '#c8321f' },
  { type: 'carom', name: 'Carom', blurb: 'Three-cushion, three balls', color: '#2f7fd0' },
  { type: 'ps5', name: 'PS5 Bay', blurb: 'Big screen, two controllers', color: '#3c7be0' },
  { type: 'simulator', name: 'Racing Simulator', blurb: 'Triple screens, wheel & seat', color: '#e0533d' },
];

interface Slot { ts: number; label: string; free: { id: number; name: string; rate: number }[]; }

@Component({
  selector: 'app-book',
  imports: [FormsModule, RouterLink, Logo],
  templateUrl: './book.html',
  styleUrl: './book.scss',
})
export class BookPage implements OnInit {
  private api = inject(Api);

  protected info = signal<PublicInfo | null>(null);
  protected avail = signal<Availability | null>(null);
  protected loadingSlots = signal(false);
  protected type = signal<TableType | null>(null);
  protected date = signal<string>('');
  protected duration = signal(60);
  protected slotTs = signal<number | null>(null);
  protected tableId = signal<number | null>(null);
  protected busy = signal(false);
  protected done = signal<PublicBooking | null>(null);

  protected form = { name: '', phone: '', email: '', players: 2, notes: '' };
  protected readonly durations = [60, 90, 120, 180];
  protected readonly durationLabel = durationLabel;

  protected tz = computed(() => this.info()?.settings.timezone ?? 'Asia/Kolkata');
  protected cur = computed(() => this.info()?.settings.currency ?? '₹');
  protected games = computed(() => {
    const tables = this.info()?.tables ?? [];
    return GAMES.filter((g) => tables.some((t) => t.type === g.type)).map((g) => {
      const ts = tables.filter((t) => t.type === g.type);
      return { ...g, count: ts.length, from: Math.min(...ts.map((t) => t.rate_per_hour)) };
    });
  });
  protected days = computed(() => {
    const i = this.info();
    if (!i) return [];
    return upcomingDays(i.server_time, i.settings.booking_max_days, this.tz()).map((d, idx) => ({
      ...d, label: idx === 0 ? 'Today' : idx === 1 ? 'Tomorrow' : dayLabel(d.ts, this.tz()),
      sub: dayLabel(d.ts, this.tz()).split(', ')[1] ?? '',
    }));
  });

  /** Start times where at least one table of the chosen game is free for the whole duration. */
  protected slots = computed<Slot[]>(() => {
    const a = this.avail(), type = this.type();
    if (!a || !type) return [];
    const step = a.slot_minutes * 60, len = this.duration() * 60;
    const tables = a.tables.filter((t) => t.type === type);
    const out: Slot[] = [];
    for (let ts = a.open_ts; ts + len <= a.close_ts; ts += step) {
      if (ts < a.earliest_ts) continue;
      const free = tables.filter((t) => !t.busy.some(([s, e]) => s < ts + len && e > ts)).map((t) => ({ id: t.id, name: t.name, rate: t.rate_per_hour }));
      out.push({ ts, label: timeLabel(ts, this.tz()), free });
    }
    return out;
  });
  protected anyFree = computed(() => this.slots().some((s) => s.free.length));
  protected slot = computed(() => this.slots().find((s) => s.ts === this.slotTs()) ?? null);
  protected chosenTable = computed(() => this.slot()?.free.find((t) => t.id === this.tableId()) ?? null);
  protected estimate = computed(() => (this.chosenTable()?.rate ?? 0) * this.duration() / 60);
  protected gameName = computed(() => GAMES.find((g) => g.type === this.type())?.name ?? '');
  protected summary = computed(() => {
    const s = this.slot();
    return s ? `${this.days().find((d) => d.ymd === this.date())?.label ?? ''} · ${s.label} – ${timeLabel(s.ts + this.duration() * 60, this.tz())}` : '';
  });

  async ngOnInit() {
    const info = await this.api.get<PublicInfo>('/public/info');
    this.info.set(info);
    this.date.set(upcomingDays(info.server_time, 1, info.settings.timezone)[0].ymd);
    if (this.games().length === 1) this.pickType(this.games()[0].type);
  }

  pickType(t: TableType) {
    this.type.set(t);
    this.clearSlot();
    if (!this.avail()) this.loadAvailability();
  }

  pickDate(d: string) {
    if (d === this.date()) return;
    this.date.set(d);
    this.clearSlot();
    this.loadAvailability();
  }

  pickDuration(m: number) {
    this.duration.set(m);
    const keep = this.slot();
    this.clearSlot();
    if (keep) { // keep the same start time if still possible
      const again = this.slots().find((s) => s.ts === keep.ts && s.free.length);
      if (again) this.pickSlot(again);
    }
  }

  pickSlot(s: Slot) {
    if (!s.free.length) return;
    this.slotTs.set(s.ts);
    this.tableId.set(s.free[0].id);
    setTimeout(() => document.getElementById('details')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  private clearSlot() {
    this.slotTs.set(null);
    this.tableId.set(null);
  }

  async loadAvailability() {
    this.loadingSlots.set(true);
    try {
      this.avail.set(await this.api.get<Availability>('/public/availability', { date: this.date() }));
    } finally {
      this.loadingSlots.set(false);
    }
  }

  async submit() {
    const s = this.slot(), t = this.chosenTable();
    if (!s || !t) return;
    this.busy.set(true);
    try {
      const b = await this.api.post<PublicBooking>('/public/bookings', {
        table_id: t.id, date: this.date(), time: hm24(s.ts, this.tz()), duration_minutes: this.duration(),
        customer_name: this.form.name, phone: this.form.phone, email: this.form.email, players: this.form.players, notes: this.form.notes,
      });
      this.done.set(b);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      this.loadAvailability(); // slot may have just been taken
    } finally {
      this.busy.set(false);
    }
  }

  bookAnother() {
    this.done.set(null);
    this.clearSlot();
    this.form = { name: this.form.name, phone: this.form.phone, email: this.form.email, players: 2, notes: '' };
    this.loadAvailability();
  }

  fmtTime(ts: number) { return timeLabel(ts, this.tz()); }
  fmtDay(ts: number) { return dayLabel(ts, this.tz()); }
  money(v: number) { return `${this.cur()}${Math.round(v).toLocaleString('en-IN')}`; }
}
