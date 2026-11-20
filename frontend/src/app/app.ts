import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Toast } from './core/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `
    <router-outlet />
    <div class="toasts" aria-live="polite">
      @for (t of toast.items(); track t.id) {
        <button class="toast" [class]="t.kind" (click)="toast.dismiss(t.id)">
          <span class="ball"></span>{{ t.text }}
        </button>
      }
    </div>
  `,
  styleUrl: './app.scss',
})
export class App {
  protected toast = inject(Toast);
}
