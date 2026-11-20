import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Auth } from '../core/auth';
import { Clock } from '../core/clock';
import { Logo } from '../shared/logo';

interface NavItem { path: string; label: string; ball: string; num: number; admin?: boolean; }

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Logo],
  template: `
    <header class="top">
      <a routerLink="/" class="brand" aria-label="Veloura Billiards home"><vb-logo [size]="44" /></a>
      <nav class="nav" aria-label="Main">
        @for (n of nav(); track n.path) {
          <a [routerLink]="n.path" routerLinkActive="on" [routerLinkActiveOptions]="{ exact: n.path === '/' }" class="nav-link">
            <span class="nb" [style.--c]="n.ball"><i>{{ n.num }}</i></span>
            <span class="nl">{{ n.label }}</span>
          </a>
        }
      </nav>
      <div class="me">
        <span class="time mono">{{ time() }}</span>
        <div class="who">
          <strong>{{ auth.user()?.name }}</strong>
          <span class="chip" [class.gold]="auth.isAdmin()">{{ auth.user()?.role }}</span>
        </div>
        <button class="btn btn-sm btn-ghost" (click)="logout()">Sign out</button>
      </div>
    </header>
    <main><router-outlet /></main>
  `,
  styleUrl: './shell.scss',
})
export class Shell {
  protected auth = inject(Auth);
  private router = inject(Router);
  private clock = inject(Clock);

  private items: NavItem[] = [
    { path: '/', label: 'Floor', ball: '#f2c230', num: 1 },
    { path: '/sessions', label: 'Sessions', ball: '#2f6fd6', num: 2 },
    { path: '/accounts', label: 'Accounts', ball: '#d8432f', num: 3 },
    { path: '/month-end', label: 'Month End', ball: '#7b3fb8', num: 4, admin: true },
    { path: '/admin', label: 'Admin', ball: '#e2742a', num: 5, admin: true },
  ];
  protected nav = computed(() => this.items.filter((i) => !i.admin || this.auth.isAdmin()));
  protected time = computed(() =>
    new Date(this.clock.now() * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  );

  async logout() {
    await this.auth.logout();
    this.router.navigate(['/login']);
  }
}
