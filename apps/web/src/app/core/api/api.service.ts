import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export const API_BASE = '/api/v1';
type Params = Record<string, string | number | boolean | null | undefined>;

function toParams(p?: Params): HttpParams {
  let hp = new HttpParams();
  for (const [k, v] of Object.entries(p ?? {})) if (v !== undefined && v !== null && v !== '') hp = hp.set(k, String(v));
  return hp;
}

/** Thin typed wrapper over HttpClient; all endpoints are relative to /api/v1. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: Params): Observable<T> {
    return this.http.get<T>(`${API_BASE}${path}`, { params: toParams(params) });
  }
  post<T>(path: string, body: unknown = {}, headers?: Record<string, string>): Observable<T> {
    return this.http.post<T>(`${API_BASE}${path}`, body, { headers });
  }
  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${API_BASE}${path}`, body);
  }
  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(`${API_BASE}${path}`, body);
  }
  download(path: string, params?: Params): Observable<Blob> {
    return this.http.get(`${API_BASE}${path}`, { params: toParams(params), responseType: 'blob' });
  }
}

/** Client-generated idempotency key for operations that must not be duplicated on retry. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
