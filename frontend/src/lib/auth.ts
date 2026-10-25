import type { AuthResponse, User } from './contracts/api.generated';

const TOKEN_KEY = 'brewlite_access_token';
const USER_KEY = 'brewlite_user';

let memoryToken: string | null = null;
let memoryUser: User | null = null;

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  if (typeof window !== 'undefined') {
    memoryToken = sessionStorage.getItem(TOKEN_KEY);
  }
  return memoryToken;
}

export function getUser(): User | null {
  if (memoryUser) return memoryUser;
  if (typeof window !== 'undefined') {
    const raw = sessionStorage.getItem(USER_KEY);
    if (raw) {
      try {
        memoryUser = JSON.parse(raw) as User;
      } catch {
        memoryUser = null;
      }
    }
  }
  return memoryUser;
}

export function setAuth(response: AuthResponse): void {
  memoryToken = response.accessToken;
  memoryUser = response.user;
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(TOKEN_KEY, response.accessToken);
    sessionStorage.setItem(USER_KEY, JSON.stringify(response.user));
    window.dispatchEvent(new Event('brewlite-auth-change'));
  }
}

export function clearAuth(): void {
  memoryToken = null;
  memoryUser = null;
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    window.dispatchEvent(new Event('brewlite-auth-change'));
  }
}

export function updateUserPoints(points: number): void {
  const current = getUser();
  if (!current) return;
  if (current.loyaltyPoints === points) return;

  const updated: User = { ...current, loyaltyPoints: points };
  memoryUser = updated;
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(USER_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('brewlite-auth-change'));
  }
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function subscribeAuth(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('brewlite-auth-change', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('brewlite-auth-change', callback);
    window.removeEventListener('storage', callback);
  };
}

export function getAuthSnapshot(): User | null {
  return getUser();
}

export function getAuthServerSnapshot(): User | null {
  return null;
}