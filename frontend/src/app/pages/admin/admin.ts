import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { periodLabel } from '../../core/clock';
import { Overview, PoolTable, Settings, TYPE_LABELS, User } from '../../core/models';
import { Toast } from '../../core/toast';
import { BarChart } from '../../shared/bar-chart';
import { MinutesPipe, MoneyPipe, PeriodPipe } from '../../shared/pipes';

type Tab = 'overview' | 'tables' | 'staff' | 'settings';
type UserForm = Partial<User> & { password?: string };

@Component({
  selector: 'app-admin',
  imports: [FormsModule, RouterLink, MoneyPipe, MinutesPipe, PeriodPipe, BarChart],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminPage implements OnInit {
  private api = inject(Api);
  private toast = inject(Toast);
  protected auth = inject(Auth);

  protected readonly typeLabels = TYPE_LABELS;
  protected tab = signal<Tab>('overview');
  protected overview = signal<Overview | null>(null);
  protected tables = signal<PoolTable[]>([]);
  protected users = signal<User[]>([]);
  protected editTable = signal<Partial<PoolTable> | null>(null);
  protected editUser = signal<UserForm | null>(null);
  protected settings: Settings = { ...this.auth.settings() };
  protected readonly bookingUrl = `${location.origin}/book`;

  protected trendLabels = computed(() => (this.overview()?.trend ?? []).map((t) => periodLabel(t.period).slice(0, 3)));
  protected trendSeries = computed(() => {
    const t = this.overview()?.trend ?? [];
    return [
      { name: 'Revenue', color: '#2fd58a', values: t.map((x) => x.revenue) },
      { name: 'Expenses', color: '#e0533d', values: t.map((x) => x.expenses) },
    ];
  });
  protected fmt = (v: number) => `${this.auth.settings().currency}${v.toLocaleString()}`;

  async ngOnInit() {
    await this.loadOverview();
    this.loadTables();
    this.loadUsers();
  }

  async loadOverview() { this.overview.set(await this.api.get<Overview>('/admin/overview')); }
  async loadTables() { this.tables.set(await this.api.get<PoolTable[]>('/admin/tables')); }
  async loadUsers() { this.users.set(await this.api.get<User[]>('/admin/users')); }

  // ----- tables -----
  newTable() {
    this.editTable.set({ name: '', type: 'pool', rate_per_hour: 200, sort_order: this.tables().length + 1, active: true });
  }
  async saveTable() {
    const t = this.editTable();
    if (!t?.name) return;
    if (t.id) await this.api.put(`/admin/tables/${t.id}`, t);
    else await this.api.post('/admin/tables', t);
    this.toast.ok('Table saved');
    this.editTable.set(null);
    this.loadTables();
  }
  async removeTable(t: PoolTable) {
    if (!confirm(`Remove ${t.name}? Tables with history are archived instead of deleted.`)) return;
    const r = await this.api.delete<{ archived?: boolean }>(`/admin/tables/${t.id}`);
    this.toast.ok(r.archived ? `${t.name} archived (it has session history)` : `${t.name} removed`);
    this.loadTables();
  }

  // ----- staff -----
  newUser() { this.editUser.set({ name: '', username: '', role: 'staff', active: true, password: '' }); }
  async saveUser() {
    const u = this.editUser();
    if (!u?.name) return;
    if (u.id) await this.api.put(`/admin/users/${u.id}`, u);
    else await this.api.post('/admin/users', u);
    this.toast.ok('Staff account saved');
    this.editUser.set(null);
    this.loadUsers();
  }

  // ----- settings -----
  exampleBilled() {
    const r = Math.max(1, Number(this.settings.round_to_minutes) || 1);
    return Math.max(Math.ceil(37 / r) * r, Number(this.settings.min_minutes) || 0);
  }

  async saveSettings() {
    const s = await this.api.put<Settings>('/settings', this.settings);
    this.auth.settings.set(s);
    this.settings = { ...s };
    this.toast.ok('Settings saved');
  }
}
