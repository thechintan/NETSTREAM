import { AuthResponse } from '@netstream/shared';

let inMemoryToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function getAccessToken(): string | null {
  return inMemoryToken;
}

export function setAccessToken(token: string | null): void {
  inMemoryToken = token;
}

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
  retryOn401?: boolean;
}

async function performRefresh(): Promise<string | null> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        setAccessToken(null);
        return null;
      }

      const data = (await response.json()) as AuthResponse;
      setAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      setAccessToken(null);
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function apiFetch<T>(
  url: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth = false, retryOn401 = true, headers: customHeaders, ...rest } = options;

  const headers = new Headers(customHeaders);
  if (!headers.has('Content-Type') && !(rest.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAccessToken();
  if (!skipAuth && token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Include cookies for refresh token handling
  const response = await fetch(url, {
    ...rest,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && retryOn401 && !skipAuth) {
    const newToken = await performRefresh();
    if (newToken) {
      // Retry original request once with new token
      headers.set('Authorization', `Bearer ${newToken}`);
      const retryResponse = await fetch(url, {
        ...rest,
        headers,
        credentials: 'include',
      });

      if (!retryResponse.ok) {
        const errorData = await retryResponse.json().catch(() => ({}));
        throw new ApiError(
          retryResponse.status,
          errorData.message || 'Request failed',
          errorData.error
        );
      }

      return (await retryResponse.json()) as T;
    }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      errorData.message || 'Request failed',
      errorData.error
    );
  }

  // Handle empty bodies (e.g. 204 or void endpoints)
  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return (await response.json()) as T;
  }

  return null as unknown as T;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const api = {
  get: <T>(url: string, options?: RequestOptions) =>
    apiFetch<T>(url, { ...options, method: 'GET' }),
  post: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(url, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(url: string, body?: unknown, options?: RequestOptions) =>
    apiFetch<T>(url, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(url: string, options?: RequestOptions) =>
    apiFetch<T>(url, { ...options, method: 'DELETE' }),
  refreshSession: performRefresh,
};
