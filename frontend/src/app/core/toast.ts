import { Injectable, signal } from '@angular/core';

export interface ToastMsg { id: number; kind: 'ok' | 'error' | 'info'; text: string; }

@Injectable({ providedIn: 'root' })
export class Toast {
  readonly items = signal<ToastMsg[]>([]);
  private seq = 0;

  ok(text: string) { this.push('ok', text); }
  info(text: string) { this.push('info', text); }
  error(text: string) { this.push('error', text); }

  dismiss(id: number) { this.items.update((l) => l.filter((t) => t.id !== id)); }

  private push(kind: ToastMsg['kind'], text: string) {
    const id = ++this.seq;
    this.items.update((l) => [...l.slice(-3), { id, kind, text }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? 6000 : 3500);
  }
}
