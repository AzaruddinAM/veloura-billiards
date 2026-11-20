import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Auth } from '../../core/auth';
import { Logo } from '../../shared/logo';

@Component({
  selector: 'app-login',
  imports: [FormsModule, Logo],
  template: `
    <div class="scene">
      <div class="table3d" aria-hidden="true">
        <div class="felt">
          @for (p of pockets; track $index) { <span class="pocket" [style.left.%]="p[0]" [style.top.%]="p[1]"></span> }
          @for (b of rack; track $index) { <span class="ball" [style.left.%]="b[0]" [style.top.%]="b[1]" [style.--c]="b[2]"></span> }
          <span class="ball cue-ball"></span>
        </div>
      </div>
      <div class="lamp" aria-hidden="true"></div>

      <form class="card login" (ngSubmit)="submit()">
        <vb-logo [size]="64" />
        <p class="muted">Sign in to open the floor.</p>
        <label class="field">Username <input name="u" [(ngModel)]="username" autocomplete="username" required /></label>
        <label class="field">Password <input name="p" type="password" [(ngModel)]="password" autocomplete="current-password" required /></label>
        <button class="btn btn-gold btn-lg" type="submit" [disabled]="busy()">{{ busy() ? 'Racking up…' : 'Break & enter' }}</button>
        <p class="hint muted">First run: <span class="mono">admin / admin123</span> or <span class="mono">staff / staff123</span>. Change these in Admin → Staff.</p>
      </form>
    </div>
  `,
  styleUrl: './login.scss',
})
export class LoginPage {
  private auth = inject(Auth);
  private router = inject(Router);
  username = '';
  password = '';
  busy = signal(false);

  pockets = [[0, 0], [50, -2], [100, 0], [0, 100], [50, 102], [100, 100]];
  rack: [number, number, string][] = [
    [70, 50, '#f2c230'], [74, 45, '#2f6fd6'], [74, 55, '#d8432f'], [78, 40, '#7b3fb8'], [78, 50, '#111'],
    [78, 60, '#e2742a'], [82, 35, '#1c8a4c'], [82, 45, '#8b1d2c'], [82, 55, '#f2c230'], [82, 65, '#2f6fd6'],
  ];

  async submit() {
    if (!this.username || !this.password) return;
    this.busy.set(true);
    try {
      await this.auth.login(this.username.trim(), this.password);
      this.router.navigate(['/']);
    } catch { /* toast already shown */ } finally {
      this.busy.set(false);
    }
  }
}
