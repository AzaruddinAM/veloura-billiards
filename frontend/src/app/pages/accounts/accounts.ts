import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { LedgerEntry, Member } from '../../core/models';
import { Toast } from '../../core/toast';
import { MoneyPipe, TimestampPipe } from '../../shared/pipes';

interface Ledger { member: { id: number; name: string; phone: string | null }; entries: LedgerEntry[]; balance: number; }

@Component({
  selector: 'app-accounts',
  imports: [FormsModule, MoneyPipe, TimestampPipe],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss',
})
export class AccountsPage implements OnInit {
  private api = inject(Api);
  private toast = inject(Toast);

  protected members = signal<Member[]>([]);
  protected selected = signal<number | null>(null);
  protected ledger = signal<Ledger | null>(null);
  protected search = signal('');
  protected editing = signal<Partial<Member> | null>(null);

  protected payAmount: number | null = null;
  protected payMethod = 'cash';
  protected payNote = '';

  protected filtered = computed(() => {
    const q = this.search().toLowerCase();
    return this.members().filter((m) => !q || m.name.toLowerCase().includes(q) || (m.phone ?? '').includes(q));
  });
  protected selectedMember = computed(() => this.members().find((m) => m.id === this.selected()) ?? null);
  protected totalDue = computed(() => this.members().reduce((a, m) => a + Math.max(0, m.balance), 0));
  protected withDues = computed(() => this.members().filter((m) => m.balance > 0).length);

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.members.set(await this.api.get<Member[]>('/members'));
    const sel = this.selected();
    if (sel) this.open(sel);
  }

  async open(id: number, reveal = false) {
    this.selected.set(id);
    this.ledger.set(await this.api.get<Ledger>(`/members/${id}/ledger`));
    // On narrow screens the ledger sits below the list — bring it into view when a member is tapped.
    if (reveal && matchMedia('(max-width: 900px)').matches) {
      setTimeout(() => document.querySelector('.detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  newMember() {
    this.editing.set({ name: '', phone: '', email: '', notes: '', active: true });
  }

  edit(m: Member) {
    this.editing.set({ ...m });
  }

  async saveMember() {
    const m = this.editing();
    if (!m?.name?.trim()) return;
    if (m.id) {
      await this.api.put(`/members/${m.id}`, m);
      this.toast.ok('Member updated');
    } else {
      const r = await this.api.post<{ id: number }>('/members', m);
      this.toast.ok('Member added');
      this.selected.set(r.id);
    }
    this.editing.set(null);
    await this.load();
  }

  async recordPayment() {
    const id = this.selected();
    if (!id || !this.payAmount || this.payAmount <= 0) return;
    await this.api.post(`/members/${id}/payments`, { amount: this.payAmount, method: this.payMethod, note: this.payNote });
    this.toast.ok('Payment recorded');
    this.payAmount = null;
    this.payNote = '';
    await this.load();
  }

  settleFull() {
    const l = this.ledger();
    if (l && l.balance > 0) this.payAmount = l.balance;
  }
}
