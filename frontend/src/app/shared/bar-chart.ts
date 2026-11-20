import { Component, computed, input } from '@angular/core';

export interface BarSeries { name: string; color: string; values: number[]; }

/** Small dependency-free SVG bar chart (grouped bars). */
@Component({
  selector: 'vb-bar-chart',
  template: `
    <svg [attr.viewBox]="'0 0 ' + W + ' ' + H" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
      @for (g of grid(); track $index) {
        <line [attr.x1]="0" [attr.x2]="W" [attr.y1]="g.y" [attr.y2]="g.y" class="grid" />
      }
      @for (b of bars(); track $index) {
        <rect [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.fill]="b.color" rx="2">
          <title>{{ b.title }}</title>
        </rect>
      }
    </svg>
    <div class="axis">
      @for (l of labels(); track $index) { <span [style.flex]="1">{{ l }}</span> }
    </div>
    @if (series().length > 1) {
      <div class="legend">
        @for (s of series(); track s.name) { <span><i [style.background]="s.color"></i>{{ s.name }}</span> }
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    svg { width: 100%; height: 180px; display: block; }
    .grid { stroke: rgba(244,236,219,.07); stroke-width: 1; vector-effect: non-scaling-stroke; }
    rect { transition: opacity .2s; } rect:hover { opacity: .75; }
    .axis { display: flex; font-size: .68rem; color: var(--muted); margin-top: 6px; text-align: center; }
    .legend { display: flex; gap: 16px; font-size: .8rem; color: var(--muted); margin-top: 10px; }
    .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; }
  `,
})
export class BarChart {
  readonly series = input.required<BarSeries[]>();
  readonly labels = input<string[]>([]);
  readonly label = input('Bar chart');
  readonly format = input<(v: number) => string>((v) => String(v));

  protected readonly W = 600;
  protected readonly H = 180;

  private max = computed(() => Math.max(1, ...this.series().flatMap((s) => s.values)));

  protected grid = computed(() => [0.25, 0.5, 0.75, 1].map((f) => ({ y: this.H - f * (this.H - 6) })));

  protected bars = computed(() => {
    const series = this.series();
    const n = Math.max(0, ...series.map((s) => s.values.length));
    if (!n) return [];
    const slot = this.W / n;
    const gap = Math.min(6, slot * 0.2);
    const bw = (slot - gap) / series.length;
    const out: { x: number; y: number; w: number; h: number; color: string; title: string }[] = [];
    series.forEach((s, si) =>
      s.values.forEach((v, i) => {
        const h = (v / this.max()) * (this.H - 6);
        out.push({ x: i * slot + gap / 2 + si * bw, y: this.H - h, w: Math.max(1, bw - 1), h, color: s.color,
          title: `${this.labels()[i] ?? i + 1} · ${s.name}: ${this.format()(v)}` });
      }),
    );
    return out;
  });
}
