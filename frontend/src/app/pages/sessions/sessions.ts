import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { currentPeriod } from '../../core/clock';
import { PoolTable, Session } from '../../core/models';
import { Toast } from '../../core/toast';
import { MinutesPipe, MoneyPipe, PeriodPipe, TimestampPipe } from '../../shared/pipes';

@Component({
  selector: 'app-sessions',
  imports: [FormsModule, MoneyPipe, MinutesPipe, TimestampPipe, PeriodPipe],
  template: `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">History</div>
          <h1>Sessions</h1>
          <p>Every billed game, with time played and how it was paid.</p>
        </div>
        <div class="row filters">
          <input type="month" [(ngModel)]="period" (change)="load()" aria-label="Month" />
          <select [(ngModel)]="tableId" (change)="load()" aria-label="Table">
            <option [ngValue]="null">All tables</option>
            @for (t of tables(); track t.id) { <option [ngValue]="t.id">{{ t.name }}</option> }
          </select>
          <input placeholder="Search player…" [(ngModel)]="q" (keyup.enter)="load()" aria-label="Search player" />
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom: 18px">
        <div class="card stat" style="--ball:#f2c230"><div class="label">Sessions · {{ period | period }}</div><div class="value">{{ rows().length }}</div></div>
        <div class="card stat" style="--ball:#2f6fd6"><div class="label">Table time</div><div class="value">{{ totals().minutes | mins }}</div></div>
        <div class="card stat" style="--ball:#d8432f"><div class="label">Discounts</div><div class="value">{{ totals().discount | money }}</div></div>
        <div class="card stat" style="--ball:#1c8a4c"><div class="label">Revenue</div><div class="value">{{ totals().total | money }}</div></div>
      </div>

      <div class="card">
        @if (rows().length) {
          <div class="table-wrap">
            <table class="data stack">
              <thead><tr><th>#</th><th>Table</th><th>Player</th><th>Start</th><th>End</th><th class="num">Time</th><th class="num">Amount</th><th class="num">Disc.</th><th class="num">Total</th><th>Paid</th>@if (auth.isAdmin()) {<th></th>}</tr></thead>
              <tbody>
                @for (s of rows(); track s.id) {
                  <tr>
                    <td class="muted mono hide-sm">{{ s.id }}</td>
                    <td class="lead"><span>{{ s.table_name }} <span class="muted sm-only">#{{ s.id }}</span></span><span class="gold mono sm-only">{{ s.total | money: 2 }}</span></td>
                    <td data-label="Player">{{ s.customer_name }}</td>
                    <td class="mono" data-label="Start">{{ s.start_ts | ts }}</td>
                    <td class="mono" data-label="End">{{ s.end_ts | ts: 'time' }}</td>
                    <td class="num" data-label="Time">{{ s.billed_minutes | mins }}</td>
                    <td class="num" data-label="Amount">{{ s.amount | money: 2 }}</td>
                    <td class="num" data-label="Discount">{{ s.discount ? (s.discount | money: 2) : '—' }}</td>
                    <td class="num gold hide-sm">{{ s.total | money: 2 }}</td>
                    <td data-label="Paid"><span class="chip" [class.blue]="s.payment_method === 'account'" [class.green]="s.payment_method !== 'account'">{{ s.payment_method === 'account' ? 'Acct · ' + s.member_name : s.payment_method }}</span></td>
                    @if (auth.isAdmin()) {<td class="act"><button class="btn btn-sm btn-ghost" (click)="remove(s)" title="Delete session" aria-label="Delete session">✕<span class="sm-only">&nbsp;Delete</span></button></td>}
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <div class="empty"><div class="ball"></div>No sessions for this filter yet.</div>
        }
      </div>
    </div>
  `,
  styles: `
    .filters input, .filters select { width: auto; min-width: 160px; }
    @media (max-width: 640px) { .filters { width: 100%; } .filters input, .filters select { min-width: 0; flex: 1 1 140px; } }
  `,
})
export class SessionsPage implements OnInit {
  private api = inject(Api);
  private toast = inject(Toast);
  protected auth = inject(Auth);
  protected rows = signal<Session[]>([]);
  protected tables = signal<PoolTable[]>([]);
  period = currentPeriod();
  tableId: number | null = null;
  q = '';

  protected totals = computed(() =>
    this.rows().reduce((a, s) => ({ minutes: a.minutes + (s.billed_minutes ?? 0), discount: a.discount + s.discount, total: a.total + (s.total ?? 0) }),
      { minutes: 0, discount: 0, total: 0 }),
  );

  async ngOnInit() {
    this.api.get<{ tables: PoolTable[] }>('/floor').then((f) => this.tables.set(f.tables)).catch(() => {});
    await this.load();
  }

  async load() {
    this.rows.set(await this.api.get<Session[]>('/sessions', { period: this.period, table_id: this.tableId, q: this.q }));
  }

  async remove(s: Session) {
    if (!confirm(`Delete session #${s.id} (${s.table_name}, ${s.customer_name})? This removes it from revenue.`)) return;
    await this.api.delete(`/sessions/${s.id}`);
    this.toast.ok('Session deleted');
    this.load();
  }
}
