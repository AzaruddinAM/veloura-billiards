import { Component, input } from '@angular/core';

/** Veloura Billiards logo: a black ball with brass ring, ivory "V" roundel and a cue. */
@Component({
  selector: 'vb-logo',
  template: `
    <svg [attr.viewBox]="compact() ? '0 0 80 80' : '0 0 360 80'" [style.height.px]="size()" role="img" aria-label="Veloura Billiards">
      <defs>
        <radialGradient id="vbBall" cx="38%" cy="32%" r="70%">
          <stop offset="0" stop-color="#2b3a33" /><stop offset=".55" stop-color="#0b1611" /><stop offset="1" stop-color="#000" />
        </radialGradient>
        <linearGradient id="vbGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#f6dc9c" /><stop offset=".5" stop-color="#d4a64a" /><stop offset="1" stop-color="#9a6f22" />
        </linearGradient>
      </defs>
      <line x1="6" y1="72" x2="78" y2="6" stroke="url(#vbGold)" stroke-width="3" stroke-linecap="round" class="cue" />
      <circle cx="40" cy="40" r="29" fill="url(#vbBall)" stroke="url(#vbGold)" stroke-width="2.5" />
      <circle cx="40" cy="40" r="15" fill="#f4ecdb" />
      <path d="M32.5 32h4.6l2.9 10.2L42.9 32h4.6l-5.6 16h-3.8z" fill="#0d3b2a" />
      <ellipse cx="30" cy="25" rx="7" ry="3.2" fill="#fff" opacity=".18" transform="rotate(-30 30 25)" />
      @if (!compact()) {
        <text x="88" y="44" font-family="Cormorant Garamond, Georgia, serif" font-size="38" font-weight="600" letter-spacing="6" fill="#f4ecdb">VELOURA</text>
        <text x="90" y="66" font-family="Manrope, Arial, sans-serif" font-size="12" font-weight="700" letter-spacing="9.5" fill="#d4a64a">BILLIARDS</text>
      }
    </svg>
  `,
  styles: `
    :host { display: inline-flex; }
    svg { display: block; width: auto; overflow: visible; }
    .cue { transition: transform .4s ease; transform-origin: 40px 40px; }
    :host(:hover) .cue { transform: translate(-3px, 3px); }
  `,
})
export class Logo {
  readonly size = input(40);
  readonly compact = input(false);
}
