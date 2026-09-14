"use client";

import { AuthLoadingScreen, AuthScreen } from "@/components/auth-screen";
import { ResetPasswordScreen } from "@/components/reset-password-screen";
import { useAuthSession } from "@/lib/use-auth-session";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { ManagerReviewHost } from "@/components/manager-review-modal";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, user, passwordRecovery } = useAuthSession();
  const pathname = usePathname();

  if (!ready) return <AuthLoadingScreen />;
  if (passwordRecovery || (!user && pathname === "/reset-password")) return <ResetPasswordScreen />;
  if (!user) return <AuthScreen />;
  return (
    <>
      <ManagerReviewHost />
      {children}
    </>
  );
}
