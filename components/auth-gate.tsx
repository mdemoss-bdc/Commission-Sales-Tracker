"use client";

import { AuthLoadingScreen, AuthScreen } from "@/components/auth-screen";
import { ResetPasswordScreen } from "@/components/reset-password-screen";
import { shouldRedirectHomeAfterSignIn } from "@/lib/auth-redirect";
import { useAuthSession } from "@/lib/use-auth-session";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { ManagerReviewHost } from "@/components/manager-review-modal";
import { CloudSyncToast } from "@/components/cloud-sync-toast";

export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, user, passwordRecovery } = useAuthSession();
  const pathname = usePathname();
  const router = useRouter();
  const sawSignedOut = useRef(false);

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

  if (!ready) return <AuthLoadingScreen />;
  if (passwordRecovery || (!user && pathname === "/reset-password")) return <ResetPasswordScreen />;
  if (!user) return <AuthScreen />;
  return (
    <>
      <ManagerReviewHost />
      <CloudSyncToast />
      {children}
    </>
  );
}
