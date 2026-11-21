import { computed, inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Api, readToken, writeToken } from './api';
import { Clock } from './clock';
import { Settings, User } from './models';

@Injectable({ providedIn: 'root' })
export class Auth {
  private api = inject(Api);
  private clock = inject(Clock);

  readonly user = signal<User | null>(null);
  readonly settings = signal<Settings>({
    business_name: 'Veloura Billiards', currency: '₹', round_to_minutes: 1, min_minutes: 0, address: '', phone: '',
    booking_enabled: true, booking_auto_confirm: false, open_time: '10:00', close_time: '23:00',
    slot_minutes: 30, booking_max_days: 14, booking_min_notice: 30,
  });
  readonly isAdmin = computed(() => this.user()?.role === 'admin');
  private restored?: Promise<boolean>;

  async login(username: string, password: string): Promise<void> {
    const res = await this.api.post<{ token: string; user: User }>('/auth/login', { username, password });
    writeToken(res.token);
    this.user.set(res.user);
    this.restored = Promise.resolve(true);
    await this.loadSettings();
  }

  async logout(): Promise<void> {
    try { await this.api.post('/auth/logout'); } catch { /* ignore */ }
    writeToken(null);
    this.user.set(null);
    this.restored = undefined;
  }

  /** Restores the session from a saved token (once per page load). */
  restore(): Promise<boolean> {
    if (!this.restored) {
      this.restored = (async () => {
        if (!readToken()) return false;
        try {
          const me = await this.api.get<{ user: User; server_time: number }>('/auth/me');
          this.user.set(me.user);
          this.clock.sync(me.server_time);
          await this.loadSettings();
          return true;
        } catch {
          writeToken(null);
          return false;
        }
      })();
    }
    return this.restored;
  }

  async loadSettings(): Promise<void> {
    this.settings.set(await this.api.get<Settings>('/settings'));
  }
}

// Note: inject() must run before the first `await` — afterwards the injection context is gone.
export const authGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return (await auth.restore()) ? true : router.createUrlTree(['/login']);
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  if (!(await auth.restore())) return router.createUrlTree(['/login']);
  return auth.isAdmin() ? true : router.createUrlTree(['/']);
};

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(Auth);
  const router = inject(Router);
  return (await auth.restore()) ? router.createUrlTree(['/']) : true;
};
