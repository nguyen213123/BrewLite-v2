import { getToken, clearAuth } from './auth';
import type { Error as ApiErrorResponse } from './contracts/api.generated';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ApiRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details: Array<{ field: string; message: string }> = [],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers(init?.headers ?? {});

  if (!headers.has('Content-Type') && init?.body && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
    signal: init?.signal ?? AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAuth();
    }

    let errorData: ApiErrorResponse | null = null;
    try {
      errorData = (await response.json()) as ApiErrorResponse;
    } catch {
      // not JSON
    }

    if (errorData && errorData.code) {
      throw new ApiRequestError(
        errorData.statusCode ?? response.status,
        errorData.code,
        errorData.message,
        errorData.details ?? [],
      );
    }

    throw new ApiRequestError(
      response.status,
      'HTTP_ERROR',
      `Yêu cầu thất bại với mã trạng thái ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

export function apiGet<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

export function apiPost<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    headers: headers ? new Headers(headers) : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
