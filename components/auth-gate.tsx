"use client";

import type { ReactNode } from "react";
import { AuthLoadingScreen, AuthScreen } from "@/components/auth-screen";
import { useAuthSession } from "@/lib/use-auth-session";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, user } = useAuthSession();

  if (!ready) return <AuthLoadingScreen />;
  if (!user) return <AuthScreen />;
  return <>{children}</>;
}
