type AuthCacheEvent = "SIGNED_IN" | "SIGNED_OUT";
type AuthCacheListener = (event: AuthCacheEvent, userId: string | null) => void;

const listeners = new Set<AuthCacheListener>();

export function onAuthCacheTransition(listener: AuthCacheListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyAuthCacheTransition(event: AuthCacheEvent, userId: string | null): void {
  for (const listener of listeners) listener(event, userId);
}
