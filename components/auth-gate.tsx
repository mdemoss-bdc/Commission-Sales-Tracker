"use client";

import { AuthScreen } from "@/components/auth-screen";
import { ResetPasswordScreen } from "@/components/reset-password-screen";
import { shouldRedirectHomeAfterSignIn } from "@/lib/auth-redirect";
import { clearDashboardAfterConfirm } from "@/lib/auth-session";
import { useAuthSession } from "@/lib/use-auth-session";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { ManagerReviewHost } from "@/components/manager-review-modal";
import { CloudSyncToast } from "@/components/cloud-sync-toast";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, user, passwordRecovery, homeAfterConfirm } = useAuthSession();
  const pathname = usePathname();
  const router = useRouter();
  const sawSignedOut = useRef(false);

  useEffect(() => {
    if (!homeAfterConfirm || passwordRecovery) return;
    clearDashboardAfterConfirm();
    if (pathname !== "/") router.replace("/");
  }, [homeAfterConfirm, passwordRecovery, pathname, router]);

  useEffect(() => {
    if (!ready) return;
    if (passwordRecovery) return;
    if (!user) {
      sawSignedOut.current = true;
      return;
    }
    if (!sawSignedOut.current) return;
    sawSignedOut.current = false;
    if (shouldRedirectHomeAfterSignIn(pathname)) router.replace("/");
  }, [ready, user, passwordRecovery, pathname, router]);

  if (passwordRecovery || (!user && pathname === "/reset-password")) return <ResetPasswordScreen />;
  if (!user) return <AuthScreen initialMode={pathname === "/signup" ? "signup" : "signin"} />;
  return (
    <>
      <ManagerReviewHost />
      <CloudSyncToast />
      {children}
    </>
  );
}
