import { Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { PublicBooking, PublicInfo } from '../../core/models';
import { Toast } from '../../core/toast';
import { dayLabel, timeLabel } from '../../core/tz';
import { Logo } from '../../shared/logo';

const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for confirmation', confirmed: 'Confirmed', seated: 'Checked in',
  completed: 'Completed', cancelled: 'Cancelled', no_show: 'Missed',
};

@Component({
  selector: 'app-manage-booking',
  imports: [FormsModule, RouterLink, Logo],
  template: `
    <div class="book">
      <header class="bar">
        <a routerLink="/book" class="brand" aria-label="Book a table"><vb-logo [size]="40" /></a>
        <a routerLink="/book" class="btn btn-gold btn-sm">Book a table</a>
      </header>
      <section class="hero">
        <div class="eyebrow">Your reservation</div>
        <h1>Manage <em>booking</em></h1>
        <p class="muted">Enter the code from your confirmation and the phone number you booked with.</p>
      </section>

      <form class="card lookup" (ngSubmit)="find()">
        <label class="field">Booking code<input name="code" [(ngModel)]="codeInput" required placeholder="VB…" autocapitalize="characters" class="mono" /></label>
        <label class="field">Phone<input name="phone" type="tel" [(ngModel)]="phone" required autocomplete="tel" inputmode="tel" /></label>
        <button class="btn btn-gold" type="submit" [disabled]="busy() || !codeInput || !phone">{{ busy() ? 'Looking…' : 'Find booking' }}</button>
      </form>

      @if (booking(); as b) {
        <section class="card result">
          <div class="row between">
            <strong class="mono code">{{ b.code }}</strong>
            <span class="chip" [class.green]="b.status === 'confirmed' || b.status === 'seated'" [class.gold]="b.status === 'pending'" [class.red]="b.status === 'cancelled' || b.status === 'no_show'">{{ statusText(b.status) }}</span>
          </div>
          <div class="ticket">
            <div><span class="k">Where</span><strong>{{ b.table_name }}</strong></div>
            <div><span class="k">When</span><strong>{{ day(b.start_ts) }}, {{ time(b.start_ts) }} – {{ time(b.end_ts) }}</strong></div>
            <div><span class="k">Name</span><strong>{{ b.customer_name }}</strong></div>
            <div><span class="k">Players</span><strong>{{ b.players }}</strong></div>
          </div>
          @if (canCancel(b)) {
            <button class="btn btn-red" (click)="cancel(b)" [disabled]="busy()">Cancel this booking</button>
          }
        </section>
      }
    </div>
  `,
  styleUrl: './book.scss',
  styles: `
    .lookup { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; margin-top: 20px; }
    .result { margin-top: 16px; display: grid; gap: 16px; }
    .between { justify-content: space-between; }
    .code { font-size: 1.4rem; letter-spacing: .1em; }
    .ticket { max-width: none; }
    @media (max-width: 640px) { .lookup { grid-template-columns: 1fr; } .result .btn { width: 100%; } }
  `,
})
export class ManageBookingPage implements OnInit {
  private api = inject(Api);
  private toast = inject(Toast);
  readonly code = input<string>(''); // ?code= from the confirmation link

  protected codeInput = '';
  protected phone = '';
  protected booking = signal<PublicBooking | null>(null);
  protected busy = signal(false);
  private tz = 'Asia/Kolkata';
  private now = Date.now() / 1000;

  async ngOnInit() {
    this.codeInput = this.code() ?? '';
    try {
      const info = await this.api.get<PublicInfo>('/public/info');
      this.tz = info.settings.timezone;
      this.now = info.server_time;
    } catch { /* defaults */ }
  }

  async find() {
    this.busy.set(true);
    this.booking.set(null);
    try {
      this.booking.set(await this.api.get<PublicBooking>(`/public/bookings/${encodeURIComponent(this.codeInput.trim().toUpperCase())}`, { phone: this.phone }));
    } catch { /* toast shown */ } finally {
      this.busy.set(false);
    }
  }

  canCancel(b: PublicBooking) {
    return (b.status === 'pending' || b.status === 'confirmed') && b.start_ts > Date.now() / 1000;
  }

  async cancel(b: PublicBooking) {
    if (!confirm(`Cancel booking ${b.code} on ${this.day(b.start_ts)} at ${this.time(b.start_ts)}?`)) return;
    this.busy.set(true);
    try {
      this.booking.set(await this.api.post<PublicBooking>(`/public/bookings/${b.code}/cancel`, { phone: this.phone }));
      this.toast.ok('Booking cancelled');
    } catch { /* toast shown */ } finally {
      this.busy.set(false);
    }
  }

  statusText(s: string) { return STATUS_TEXT[s] ?? s; }
  day(ts: number) { return dayLabel(ts, this.tz); }
  time(ts: number) { return timeLabel(ts, this.tz); }
}
