// The signed-in user, loaded once and shared by every view.

import { api, type User } from "./api";

let current: Promise<User | null> | null = null;
const listeners = new Set<(u: User | null) => void>();

export function currentUser(): Promise<User | null> {
  // If the API is unreachable (e.g. static preview without functions), act signed out.
  current ??= api.me().then((r) => r.user, () => null);
  return current;
}

export function setUser(user: User | null) {
  current = Promise.resolve(user);
  listeners.forEach((fn) => fn(user));
}

export function onUserChange(fn: (u: User | null) => void) {
  listeners.add(fn);
}

/** Path to return to after signing in. */
export function loginUrl(next = location.pathname + location.search) {
  return `/login?next=${encodeURIComponent(next)}`;
}
