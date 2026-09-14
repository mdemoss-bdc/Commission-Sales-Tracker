import { getSupabase, isSupabaseConfigured } from "./supabase.ts";

export type SessionUser = {
  id: string;
  email: string | null;
};

type AuthListener = () => void;

const listeners = new Set<AuthListener>();
const userChangeListeners = new Set<(user: SessionUser | null) => void>();

let currentUser: SessionUser | null = null;
let authReady = false;
let startPromise: Promise<void> | null = null;

function emit() {
  for (const listener of listeners) listener();
}

function toUser(user: { id: string; email?: string | null } | null | undefined): SessionUser | null {
  if (!user?.id) return null;
  return { id: user.id, email: user.email ?? null };
}

function setCurrentUser(next: SessionUser | null) {
  const previousId = currentUser?.id ?? null;
  const nextId = next?.id ?? null;
  currentUser = next;
  emit();
  if (previousId === nextId) return;
  for (const listener of userChangeListeners) listener(next);
}

export function getSessionUser(): SessionUser | null {
  return currentUser;
}

export function subscribeAuth(listener: AuthListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function onAuthUserChange(listener: (user: SessionUser | null) => void) {
  userChangeListeners.add(listener);
  return () => {
    userChangeListeners.delete(listener);
  };
}

export async function initAuth(): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    const supabase = getSupabase();
    if (!supabase) {
      authReady = true;
      emit();
      return;
    }
    const { data } = await supabase.auth.getSession();
    currentUser = toUser(data.session?.user);
    authReady = true;
    emit();
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
      setCurrentUser(toUser(session?.user));
    });
  })();
  return startPromise;
}

export function isAuthReady(): boolean {
  return authReady;
}

export type AuthActionResult =
  | { status: "signed-in"; user: SessionUser }
  | { status: "confirm-email" }
  | { status: "error"; message: string };

function mapAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid login")) return "Email or password is not correct.";
  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return "That email already has an account. Sign in instead.";
  }
  if (lower.includes("password")) return "Password must be at least 6 characters.";
  if (lower.includes("email")) return "Enter a valid email address.";
  return message;
}

export async function signInWithPassword(email: string, password: string): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return { status: "error", message: "Supabase is not configured." };
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { status: "error", message: mapAuthError(error.message) };
  const user = toUser(data.user);
  if (!user) return { status: "error", message: "Sign in did not return a user." };
  setCurrentUser(user);
  return { status: "signed-in", user };
}

export async function signUpWithPassword(email: string, password: string): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return { status: "error", message: "Supabase is not configured." };
  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/` : undefined;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });
  if (error) return { status: "error", message: mapAuthError(error.message) };
  const user = toUser(data.user);
  if (!data.session || !user) return { status: "confirm-email" };
  setCurrentUser(user);
  return { status: "signed-in", user };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (supabase) await supabase.auth.signOut();
  setCurrentUser(null);
}

export function useAuthConfigured(): boolean {
  return isSupabaseConfigured();
}
