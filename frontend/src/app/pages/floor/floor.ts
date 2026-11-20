import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { Clock, estimateBill, hms } from '../../core/clock';
import { Floor, FloorTable, Member, PaymentMethod, Session, TYPE_LABELS } from '../../core/models';
import { Toast } from '../../core/toast';
import { MinutesPipe, MoneyPipe, TimestampPipe } from '../../shared/pipes';
import { Ball, POCKETS, rackFor, scatterFor } from './balls';

interface StopState {
  table: FloorTable;
  session: Session;
  quote: { billed_minutes: number; amount: number; minutes: number };
  method: PaymentMethod;
  memberId: number | null;
  discount: number;
  notes: string;
  done?: Session;
  busy: boolean;
}

@Component({
  selector: 'app-floor',
  imports: [FormsModule, MoneyPipe, MinutesPipe, TimestampPipe],
  templateUrl: './floor.html',
  styleUrls: ['./floor.scss', './stations.scss'],
  host: { '(document:keydown)': 'onKey($event)', '(window:resize)': 'onResize()' },
})
export class FloorPage implements OnInit, OnDestroy {
  private api = inject(Api);
  protected auth = inject(Auth);
  private clock = inject(Clock);
  private toast = inject(Toast);

  protected readonly pockets = POCKETS;
  protected readonly tables = signal<FloorTable[]>([]);
  protected readonly today = signal({ sessions: 0, revenue: 0, minutes: 0 });
  protected readonly members = signal<Member[]>([]);
  protected readonly loaded = signal(false);
  protected readonly active = signal(0);
  protected readonly rotation = signal(0);
  protected readonly tilt = signal({ x: 0, y: 0 });
  protected readonly dragging = signal(false);
  protected readonly stop = signal<StopState | null>(null);
  protected readonly starting = signal(false);

  // start form
  protected startName = '';
  protected startMember: number | null = null;
  protected startPlayers = 2;

  private poll?: ReturnType<typeof setInterval>;
  private drag = { x: 0, rot: 0, moved: false, slot: -1, id: -1 };
  private ballCache = new Map<string, Ball[]>();

  protected readonly count = computed(() => this.tables().length);
  protected readonly step = computed(() => 360 / Math.max(1, this.count()));
  protected readonly radius = computed(() => {
    const n = this.count();
    return n < 3 ? 420 : Math.max(440, Math.round(330 / (2 * Math.tan(Math.PI / n))) + 90);
  });
  protected readonly current = computed(() => this.tables()[this.active()] ?? null);
  protected readonly running = computed(() => this.tables().filter((t) => t.session).length);
  protected readonly sceneTransform = computed(() => {
    const { x, y } = this.tilt();
    return `translateZ(-${this.radius()}px) rotateX(${-6 + y * 5}deg) rotateY(${-this.rotation() + x * 6}deg)`;
  });
  protected readonly liveTotal = computed(() => {
    const now = this.clock.now();
    return this.tables().reduce((sum, t) => sum + (t.session ? this.estimate(t, now).amount : 0), 0);
  });
  protected readonly activeMembers = computed(() => this.members().filter((m) => m.active));

  async ngOnInit() {
    await this.load();
    this.loaded.set(true);
    const firstRunning = this.tables().findIndex((t) => t.session);
    if (firstRunning > 0) this.goTo(firstRunning, true);
    this.api.get<Member[]>('/members').then((m) => this.members.set(m)).catch(() => {});
    this.poll = setInterval(() => this.load().catch(() => {}), 15000);
  }

  ngOnDestroy() {
    clearInterval(this.poll);
  }

  async load() {
    const f = await this.api.get<Floor>('/floor');
    this.clock.sync(f.server_time);
    this.auth.settings.set(f.settings);
    this.tables.set(f.tables);
    this.today.set(f.today);
    if (this.active() >= f.tables.length) this.goTo(0, true);
  }

  // ---------- 3D navigation ----------
  /**
   * Phones shrink each model. The scale goes LAST in the slot's transform so it shrinks the model
   * in place — the CSS `scale` property would apply before the ring rotation and push the front
   * table off-centre.
   */
  protected readonly slotScale = signal(this.scaleFor());

  private scaleFor() {
    return typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches ? 0.78 : 1;
  }

  onResize() {
    this.slotScale.set(this.scaleFor());
  }

  slotTransform(i: number) {
    const s = this.slotScale();
    return `rotateY(${i * this.step()}deg) translateZ(${this.radius()}px)` + (s !== 1 ? ` scale(${s})` : '');
  }

  slotOpacity(i: number) {
    const rel = this.relAngle(i);
    return Math.max(0.12, 1 - (Math.abs(rel) / 180) * 1.05);
  }

  private relAngle(i: number) {
    return ((((i * this.step() - this.rotation()) % 360) + 540) % 360) - 180;
  }

  goTo(i: number, instant = false) {
    const n = this.count();
    if (!n) return;
    i = ((i % n) + n) % n;
    const rot = this.rotation();
    const delta = ((((i * this.step() - rot) % 360) + 540) % 360) - 180;
    this.rotation.set(instant ? i * this.step() : rot + delta);
    if (this.active() !== i) {
      this.active.set(i);
      this.resetStartForm();
    }
  }

  /** Floor-map tap: bring the table forward and, on phones, scroll back up to the 3D view and its controls. */
  pickFromMap(i: number) {
    this.goTo(i);
    if (matchMedia('(max-width: 900px)').matches) {
      document.querySelector('.stage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  next() { this.goTo(this.active() + 1); }
  prev() { this.goTo(this.active() - 1); }

  onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (this.stop() || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'ArrowRight') { this.next(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { this.prev(); e.preventDefault(); }
  }

  onPointerDown(e: PointerEvent) {
    const slot = (e.target as HTMLElement).closest('[data-i]');
    this.drag = { x: e.clientX, rot: this.rotation(), moved: false, slot: slot ? Number(slot.getAttribute('data-i')) : -1, id: e.pointerId };
    this.dragging.set(true);
  }

  onPointerMove(e: PointerEvent, stage: HTMLElement) {
    const r = stage.getBoundingClientRect();
    this.tilt.set({ x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 });
    if (!this.dragging() || e.pointerId !== this.drag.id) return;
    const dx = e.clientX - this.drag.x;
    if (!this.drag.moved && Math.abs(dx) > 6) {
      this.drag.moved = true;
      stage.setPointerCapture(e.pointerId);
    }
    if (this.drag.moved) this.rotation.set(this.drag.rot - dx * 0.28);
  }

  onPointerUp() {
    if (!this.dragging()) return;
    this.dragging.set(false);
    if (this.drag.moved) {
      this.goTo(Math.round(this.rotation() / this.step()));
    } else if (this.drag.slot >= 0) {
      this.goTo(this.drag.slot);
    }
  }

  onLeave() {
    this.tilt.set({ x: 0, y: 0 });
    this.onPointerUp();
  }

  // ---------- Table visuals ----------
  balls(t: FloorTable): Ball[] {
    const key = `${t.id}:${t.type}:${t.session ? t.session.id : 'rack'}`;
    let b = this.ballCache.get(key);
    if (!b) {
      b = t.session ? scatterFor(t.type, t.session.id * 7 + t.id) : rackFor(t.type);
      this.ballCache.set(key, b);
    }
    return b;
  }

  estimate(t: FloorTable, now = this.clock.now()) {
    return t.session ? estimateBill(t.session.start_ts, now, t.session.rate_per_hour, this.auth.settings()) : { minutes: 0, billed: 0, amount: 0 };
  }

  elapsed(t: FloorTable): string {
    return t.session ? hms(this.clock.now() - t.session.start_ts) : '00:00:00';
  }

  isGaming(t: FloorTable): boolean {
    return t.type === 'ps5' || t.type === 'simulator';
  }

  typeLabel(type: FloorTable['type']): string {
    return TYPE_LABELS[type] ?? type;
  }

  /** A playful lap counter for the simulator screen (one lap ≈ 2 minutes). */
  lap(t: FloorTable): number {
    return t.session ? Math.floor((this.clock.now() - t.session.start_ts) / 120) + 1 : 1;
  }

  /** 0..1 progress around the current hour, used for the brass timer ring. */
  hourProgress(t: FloorTable): number {
    if (!t.session) return 0;
    return ((this.clock.now() - t.session.start_ts) % 3600) / 3600;
  }

  // ---------- Actions ----------
  private resetStartForm() {
    this.startName = '';
    this.startMember = null;
    this.startPlayers = 2;
  }

  async start(t: FloorTable) {
    this.starting.set(true);
    try {
      const s = await this.api.post<Session>(`/tables/${t.id}/start`, {
        customer_name: this.startName, member_id: this.startMember, players: this.startPlayers,
      });
      this.tables.update((list) => list.map((x) => (x.id === t.id ? { ...x, session: s } : x)));
      this.toast.ok(`${t.name} started — timer running`);
      this.resetStartForm();
    } catch { /* toast shown */ } finally {
      this.starting.set(false);
    }
  }

  async openStop(t: FloorTable) {
    if (!t.session) return;
    const quote = await this.api.get<StopState['quote']>(`/sessions/${t.session.id}/quote`);
    this.stop.set({
      table: t, session: t.session, quote, method: t.session.member_id ? 'account' : 'cash',
      memberId: t.session.member_id, discount: 0, notes: '', busy: false,
    });
  }

  patchStop(p: Partial<StopState>) {
    this.stop.update((s) => (s ? { ...s, ...p } : s));
  }

  async confirmStop() {
    const st = this.stop();
    if (!st) return;
    this.patchStop({ busy: true });
    try {
      const done = await this.api.post<Session>(`/sessions/${st.session.id}/stop`, {
        payment_method: st.method, member_id: st.memberId, discount: st.discount || 0, notes: st.notes || null,
      });
      this.patchStop({ done, busy: false });
      this.tables.update((list) => list.map((x) => (x.id === st.table.id ? { ...x, session: null } : x)));
      this.today.update((d) => ({ sessions: d.sessions + 1, revenue: d.revenue + (done.total ?? 0), minutes: d.minutes + (done.billed_minutes ?? 0) }));
      if (st.method === 'account') this.api.get<Member[]>('/members').then((m) => this.members.set(m)).catch(() => {});
    } catch {
      this.patchStop({ busy: false });
    }
  }

  async cancelSession(t: FloorTable) {
    if (!t.session || !confirm(`Cancel the running session on ${t.name}? No bill will be recorded.`)) return;
    await this.api.post(`/sessions/${t.session.id}/cancel`);
    this.tables.update((list) => list.map((x) => (x.id === t.id ? { ...x, session: null } : x)));
    this.toast.info(`${t.name} cancelled`);
  }

  printReceipt() {
    window.print();
  }

  memberName(id: number | null) {
    return this.members().find((m) => m.id === id)?.name ?? '';
  }
}
