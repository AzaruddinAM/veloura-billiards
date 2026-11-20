import { HttpClient, HttpErrorResponse, HttpInterceptorFn, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { Toast } from './toast';

const TOKEN_KEY = 'vb.token';

export function readToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function writeToken(token: string | null): void {
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
}

/** Adds the bearer token and turns API errors into readable messages. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = readToken();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.endsWith('/auth/login')) {
        writeToken(null);
        router.navigate(['/login']);
      }
      const message = err.error?.error ?? (err.status === 0 ? 'Cannot reach the server. Is the PHP API running?' : err.message);
      return throwError(() => new Error(message));
    }),
  );
};

type Params = Record<string, string | number | boolean | null | undefined>;

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  private toast = inject(Toast);
  private base = '/api';

  get<T>(path: string, params: Params = {}): Promise<T> {
    let hp = new HttpParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') hp = hp.set(k, String(v));
    return this.wrap(firstValueFrom(this.http.get<T>(this.base + path, { params: hp })));
  }
  post<T>(path: string, body: unknown = {}): Promise<T> {
    return this.wrap(firstValueFrom(this.http.post<T>(this.base + path, body)));
  }
  put<T>(path: string, body: unknown = {}): Promise<T> {
    return this.wrap(firstValueFrom(this.http.put<T>(this.base + path, body)));
  }
  delete<T>(path: string): Promise<T> {
    return this.wrap(firstValueFrom(this.http.delete<T>(this.base + path)));
  }

  private async wrap<T>(p: Promise<T>): Promise<T> {
    try {
      return await p;
    } catch (e) {
      this.toast.error((e as Error).message);
      throw e;
    }
  }
}
