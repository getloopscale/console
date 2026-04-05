// API client for the Theo Cloud dashboard.
//
// Token storage strategy:
// - Access token in sessionStorage (survives redirects, cleared on tab close)
// - NOT localStorage (XSS risk for long-lived tokens)
// - NOT in-memory (lost on OAuth redirects)

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:13002';
const ENGINE_API = import.meta.env.VITE_ENGINE_URL || 'http://localhost:13001';

export function getApiBase() { return API_BASE; }
export function getEngineBase() { return ENGINE_API; }

export async function cloudFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  return apiFetch<T>(API_BASE, path, options);
}

export async function engineFetch<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  return apiFetch<T>(ENGINE_API, path, options);
}

async function apiFetch<T>(base: string, path: string, options: RequestInit = {}): Promise<T | null> {
  const token = getToken();
  if (!token && !path.startsWith('/v1/auth/')) {
    window.location.href = '/login';
    return null;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    const resp = await fetch(`${base}${path}`, { ...options, headers });
    if (resp.status === 401) {
      clearAuth();
      window.location.href = '/login';
      return null;
    }
    if (!resp.ok) return null;
    return await resp.json() as T;
  } catch {
    return null;
  }
}

// --- Auth state (sessionStorage — survives OAuth redirects) ---

export function getToken(): string | null {
  return sessionStorage.getItem('theo_token');
}

export function setAuth(token: string, refresh: string, email: string, name?: string) {
  sessionStorage.setItem('theo_token', token);
  sessionStorage.setItem('theo_refresh', refresh);
  sessionStorage.setItem('theo_email', email);
  if (name) sessionStorage.setItem('theo_name', name);
}

export function clearAuth() {
  sessionStorage.removeItem('theo_token');
  sessionStorage.removeItem('theo_refresh');
  sessionStorage.removeItem('theo_email');
  sessionStorage.removeItem('theo_name');
}

export function getEmail(): string | null {
  return sessionStorage.getItem('theo_email');
}

export function getName(): string | null {
  return sessionStorage.getItem('theo_name');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
