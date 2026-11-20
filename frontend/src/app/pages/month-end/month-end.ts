import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { currentPeriod, periodLabel } from '../../core/clock';
import { Closing, MonthReport } from '../../core/models';
import { Toast } from '../../core/toast';
import { BarChart } from '../../shared/bar-chart';
import { MinutesPipe, MoneyPipe, PeriodPipe, TimestampPipe } from '../../shared/pipes';

@Component({
  selector: 'app-month-end',
  imports: [FormsModule, MoneyPipe, MinutesPipe, PeriodPipe, TimestampPipe, BarChart],
  templateUrl: './month-end.html',
  styleUrl: './month-end.scss',
})
export class MonthEndPage implements OnInit {
  private api = inject(Api);
  private toast = inject(Toast);
  private auth = inject(Auth);

  protected period = signal(currentPeriod());
  protected report = signal<MonthReport | null>(null);
  protected closings = signal<Closing[]>([]);
  protected busy = signal(false);
  protected readonly categories = ['Rent', 'Electricity', 'Salaries', 'Maintenance', 'Cloth & cues', 'Snacks & drinks', 'Marketing', 'Other'];

  protected exp = { date: new Date().toISOString().slice(0, 10), category: 'Electricity', amount: null as number | null, note: '' };

  protected methods = computed(() => {
    const r = this.report();
    if (!r) return [];
    const total = Math.max(1, r.revenue);
    return Object.entries(r.by_method).map(([k, v]) => ({ k, v, pct: (v / total) * 100 }));
  });
  protected expCats = computed(() => Object.entries(this.report()?.expenses_by_category ?? {}).sort((a, b) => b[1] - a[1]));
  protected dailyLabels = computed(() => (this.report()?.daily ?? []).map((_, i) => ((i + 1) % 5 === 0 || i === 0 ? String(i + 1) : '')));
  protected fmt = (v: number) => `${this.auth.settings().currency}${v.toLocaleString()}`;
  protected isCurrent = computed(() => this.period() === currentPeriod());

  async ngOnInit() {
    await Promise.all([this.load(), this.loadClosings()]);
  }

  async load() {
    this.report.set(await this.api.get<MonthReport>('/reports/month', { period: this.period() }));
  }

  async loadClosings() {
    this.closings.set(await this.api.get<Closing[]>('/reports/closings'));
  }

  setPeriod(p: string) {
    if (!p) return;
    this.period.set(p);
    this.load();
  }

  shift(delta: number) {
    const [y, m] = this.period().split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    this.setPeriod(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  async addExpense() {
    if (!this.exp.amount) return;
    await this.api.post('/expenses', this.exp);
    this.toast.ok('Expense added');
    this.exp.amount = null;
    this.exp.note = '';
    const p = this.exp.date.slice(0, 7);
    if (p !== this.period()) this.period.set(p);
    await this.load();
  }

  async removeExpense(id: number) {
    if (!confirm('Delete this expense?')) return;
    await this.api.delete(`/expenses/${id}`);
    await this.load();
  }

  async close() {
    const r = this.report();
    if (!r) return;
    const msg = `Close ${periodLabel(r.period)}?\n\nRevenue ${this.fmt(r.revenue)}, expenses ${this.fmt(r.expenses_total)}, net ${this.fmt(r.net)}.\n\nSessions, payments and expenses in this month will be locked.`;
    if (!confirm(msg)) return;
    this.busy.set(true);
    try {
      this.report.set(await this.api.post<MonthReport>('/reports/month/close', { period: r.period }));
      this.toast.ok(`${periodLabel(r.period)} closed`);
      await this.loadClosings();
    } finally {
      this.busy.set(false);
    }
  }

  async reopen() {
    const r = this.report();
    if (!r || !confirm(`Reopen ${periodLabel(r.period)}? Its figures can then be changed again.`)) return;
    await this.api.post('/reports/month/reopen', { period: r.period });
    this.toast.info(`${periodLabel(r.period)} reopened`);
    await Promise.all([this.load(), this.loadClosings()]);
  }

  print() {
    window.print();
  }

  exportCsv() {
    const r = this.report();
    if (!r) return;
    const rows: (string | number)[][] = [
      ['Veloura Billiards — Month end', periodLabel(r.period)],
      [],
      ['Sessions', r.sessions_count], ['Billed minutes', r.minutes], ['Gross', r.gross], ['Discounts', r.discounts],
      ['Revenue', r.revenue], ['Expenses', r.expenses_total], ['Net', r.net], ['Collected (cash flow)', r.collected],
      [],
      ['Payment method', 'Amount'], ...Object.entries(r.by_method),
      [],
      ['Table', 'Sessions', 'Minutes', 'Revenue'], ...r.by_table.map((t) => [t.name, t.sessions, t.minutes, t.revenue]),
      [],
      ['Expense date', 'Category', 'Amount', 'Note'], ...r.expenses.map((e) => [new Date(e.ts * 1000).toLocaleDateString(), e.category, e.amount, e.note ?? '']),
      [],
      ['Member', 'Charges', 'Payments', 'Balance'], ...r.outstanding.map((m) => [m.name, m.charges, m.payments, m.balance]),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `veloura-month-end-${r.period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
