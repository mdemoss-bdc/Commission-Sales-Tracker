import { getSupabase, isSupabaseConfigured } from "./supabase.ts";

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string | null;
};

type AuthListener = () => void;

const listeners = new Set<AuthListener>();
const userChangeListeners = new Set<(user: SessionUser | null) => void>();

let currentUser: SessionUser | null = null;
let authReady = false;
let passwordRecovery = false;
let startPromise: Promise<void> | null = null;

const SESSION_WAIT_MS = 3500;

function emit() {
  for (const listener of listeners) listener();
}

function metadataName(user: { user_metadata?: Record<string, unknown> } | null | undefined): string | null {
  const value = user?.user_metadata?.full_name;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function toUser(
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null | undefined,
): SessionUser | null {
  if (!user?.id) return null;
  return { id: user.id, email: user.email ?? null, fullName: metadataName(user) };
}

function setPasswordRecovery(next: boolean) {
  if (passwordRecovery === next) return;
  passwordRecovery = next;
  emit();
}

function setCurrentUser(next: SessionUser | null) {
  const previousId = currentUser?.id ?? null;
  const nextId = next?.id ?? null;
  currentUser = next;
  emit();
  if (previousId === nextId) return;
  for (const listener of userChangeListeners) listener(next);
}

function recoveryFlagInUrl(): boolean {
  if (typeof window === "undefined") return false;
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return search.get("type") === "recovery" || hash.get("type") === "recovery";
}

export function getSessionUser(): SessionUser | null {
  return currentUser;
}

export function isPasswordRecovery(): boolean {
  return passwordRecovery;
}

export function clearPasswordRecovery() {
  setPasswordRecovery(false);
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

    if (recoveryFlagInUrl()) setPasswordRecovery(true);

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      if (event === "SIGNED_OUT") setPasswordRecovery(false);
      setCurrentUser(toUser(session?.user));
    });

    const sessionWork = supabase.auth
      .getSession()
      .then(({ data }) => {
        setCurrentUser(toUser(data.session?.user));
        if (recoveryFlagInUrl()) setPasswordRecovery(true);
      })
      .catch(() => {
        /* Auth screen still renders after the timeout. */
      });

    await Promise.race([
      sessionWork,
      new Promise<void>((resolve) => {
        setTimeout(resolve, SESSION_WAIT_MS);
      }),
    ]);

    authReady = true;
    emit();
    if (typeof window !== "undefined") {
      window.setInterval(() => {
        if (!currentUser) return;
        void refreshAuthSession();
      }, 4 * 60 * 1000);
    }
  })();
  return startPromise;
}

function errorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error && typeof (error as { message: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

export function isMissingAuthSession(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes("auth session missing");
}

export async function refreshAuthSession(): Promise<SessionUser | null> {
  const supabase = getSupabase();
  if (!supabase) return currentUser;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      if (isMissingAuthSession(error)) {
        setCurrentUser(null);
        return null;
      }
      console.error("supabase.auth.getSession failed:", error.message);
    }
    let session = data.session;
    if (!session) {
      setCurrentUser(null);
      return null;
    }
    const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
    const needsRefresh = expiresAtMs > 0 && expiresAtMs < Date.now() + 60_000;
    if (needsRefresh) {
      const refreshed = await supabase.auth.refreshSession();
      if (refreshed.error) {
        if (isMissingAuthSession(refreshed.error)) {
          setCurrentUser(null);
          return null;
        }
        console.error("supabase.auth.refreshSession failed:", refreshed.error.message);
      } else if (refreshed.data.session) {
        session = refreshed.data.session;
      }
    }
    if (session?.user) setCurrentUser(toUser(session.user));
  } catch (error) {
    if (isMissingAuthSession(error)) {
      setCurrentUser(null);
      return null;
    }
    console.error("Auth session refresh failed:", error);
  }
  return currentUser;
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
  if (lower.includes("full name") || lower.includes("full_name")) return "Enter your full name.";
  if (lower.includes("location")) return "Select your dealership store.";
  if (lower.includes("email")) return "Enter a valid email address.";
  return message;
}

function siteOrigin(): string | undefined {
  return typeof window !== "undefined" ? window.location.origin : undefined;
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

export async function signUpWithPassword(
  email: string,
  password: string,
  fullName: string,
  locationId?: string | null,
  signupMode: "join" | "new_dealership" = "join",
): Promise<AuthActionResult> {
  const supabase = getSupabase();
  if (!supabase) return { status: "error", message: "Supabase is not configured." };
  const cleanedName = fullName.trim();
  const cleanedLocation = locationId?.trim() ?? "";
  if (!cleanedName) return { status: "error", message: "Enter your full name." };
  if (signupMode !== "new_dealership" && !cleanedLocation) {
    return { status: "error", message: "Select your dealership store." };
  }
  const metadata: Record<string, string> = {
    full_name: cleanedName,
    signup_mode: signupMode,
  };
  if (cleanedLocation) metadata.location_id = cleanedLocation;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: siteOrigin() ? `${siteOrigin()}/` : undefined,
      data: metadata,
    },
  });
  if (error) return { status: "error", message: mapAuthError(error.message) };
  const user = toUser(data.user);
  if (!data.session || !user) return { status: "confirm-email" };
  setCurrentUser(user);
  return { status: "signed-in", user };
}

export async function sendPasswordResetEmail(email: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Supabase is not configured.";
  const cleaned = email.trim();
  if (!cleaned) return "Enter the email for your account.";
  const redirectTo = siteOrigin() ? `${siteOrigin()}/reset-password` : undefined;
  const { error } = await supabase.auth.resetPasswordForEmail(cleaned, { redirectTo });
  return error ? mapAuthError(error.message) : null;
}

export async function updateSessionFullName(fullName: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  const cleaned = fullName.trim();
  if (!cleaned) return "Enter your full name.";
  const { data, error } = await supabase.auth.updateUser({ data: { full_name: cleaned } });
  if (error) return error.message;
  setCurrentUser(toUser(data.user));
  return null;
}

export async function updateSessionEmail(email: string): Promise<
  { status: "updated" } | { status: "confirm" } | { status: "error"; message: string }
> {
  const supabase = getSupabase();
  if (!supabase) return { status: "error", message: "Not signed in." };
  const cleaned = email.trim();
  if (!cleaned) return { status: "error", message: "Enter a valid email address." };
  const { data, error } = await supabase.auth.updateUser({ email: cleaned });
  if (error) return { status: "error", message: mapAuthError(error.message) };
  setCurrentUser(toUser(data.user));
  if (data.user?.email?.toLowerCase() === cleaned.toLowerCase()) return { status: "updated" };
  return { status: "confirm" };
}

export async function updateSessionPassword(password: string): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return "Not signed in.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) return mapAuthError(error.message);
  setCurrentUser(toUser(data.user));
  setPasswordRecovery(false);
  return null;
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (supabase) await supabase.auth.signOut();
  setPasswordRecovery(false);
  setCurrentUser(null);
}

export function useAuthConfigured(): boolean {
  return isSupabaseConfigured();
}
