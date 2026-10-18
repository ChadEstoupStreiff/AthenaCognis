import { HttpClient, HttpContext, type HttpParameterCodec, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, type Observable, takeUntil } from 'rxjs';
import { SILENT_ERRORS } from './api-error';

/** Scalar query parameter; `null`/`undefined` values are dropped. */
export type QueryValue = string | number | boolean | null | undefined;

/** Query parameters of a request. */
export type QueryParams = Readonly<Record<string, QueryValue>>;

/** Options shared by every request. */
export interface RequestOptions {
  readonly params?: QueryParams;
  /** Skip the global error toast (the caller handles the failure). */
  readonly silent?: boolean;
  readonly signal?: AbortSignal;
}

/** HTTP methods used by the SPA. */
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Strict codec: every reserved character is percent-encoded (the backend splits on `,`, `&`, `+`). */
class StrictCodec implements HttpParameterCodec {
  /**
   * Encode a key.
   *
   * @param key - Key.
   * @returns Encoded key.
   */
  encodeKey(key: string): string {
    return encodeURIComponent(key);
  }

  /**
   * Encode a value.
   *
   * @param value - Value.
   * @returns Encoded value.
   */
  encodeValue(value: string): string {
    return encodeURIComponent(value);
  }

  /**
   * Decode a key.
   *
   * @param key - Encoded key.
   * @returns Decoded key.
   */
  decodeKey(key: string): string {
    return decodeURIComponent(key);
  }

  /**
   * Decode a value.
   *
   * @param value - Encoded value.
   * @returns Decoded value.
   */
  decodeValue(value: string): string {
    return decodeURIComponent(value);
  }
}

const CODEC = new StrictCodec();

/**
 * Build Angular HTTP params, dropping empty values.
 *
 * @param params - Query parameters.
 * @returns HTTP params.
 */
function toHttpParams(params: QueryParams | undefined): HttpParams {
  let httpParams = new HttpParams({ encoder: CODEC });
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== null && value !== undefined) {
      httpParams = httpParams.set(key, String(value));
    }
  }
  return httpParams;
}

/** URL prefix proxied to FastAPI (nginx in Docker, the Angular dev server locally). */
export const API_PREFIX = '/api';

/**
 * Build the URL of a backend path.
 *
 * @param path - Backend path starting with `/`, file segments already encoded.
 * @returns The proxied URL.
 */
export function backendUrl(path: string): string {
  return `${API_PREFIX}${path}`;
}

/** Promise-based JSON client for the FastAPI backend. */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  /**
   * Send a GET request.
   *
   * @param url - URL.
   * @param options - Request options.
   * @returns The parsed body.
   */
  get<T>(url: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', url, undefined, options);
  }

  /**
   * Send a POST request.
   *
   * @param url - URL.
   * @param body - JSON body.
   * @param options - Request options.
   * @returns The parsed body.
   */
  post<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', url, body, options);
  }

  /**
   * Send a PUT request.
   *
   * @param url - URL.
   * @param body - JSON body.
   * @param options - Request options.
   * @returns The parsed body.
   */
  put<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', url, body, options);
  }

  /**
   * Send a PATCH request.
   *
   * @param url - URL.
   * @param body - JSON body.
   * @param options - Request options.
   * @returns The parsed body.
   */
  patch<T>(url: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', url, body, options);
  }

  /**
   * Send a DELETE request.
   *
   * @param url - URL.
   * @param options - Request options.
   * @returns The parsed body.
   */
  delete<T>(url: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', url, undefined, options);
  }

  /**
   * Send a request and resolve with its body.
   *
   * @param method - HTTP method.
   * @param url - URL.
   * @param body - JSON body.
   * @param options - Request options.
   * @returns The parsed body.
   */
  private request<T>(
    method: Method,
    url: string,
    body: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const context = new HttpContext().set(SILENT_ERRORS, options?.silent ?? false);
    let observable: Observable<T> = this.http.request<T>(method, url, {
      body,
      params: toHttpParams(options?.params),
      context,
    });
    const signal = options?.signal;
    if (signal !== undefined) {
      observable = observable.pipe(takeUntil(fromEvent(signal, 'abort')));
    }
    return firstValueFrom(observable);
  }
}
