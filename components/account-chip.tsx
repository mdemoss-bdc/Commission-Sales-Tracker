"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-session";
import { isSupabaseConfigured } from "@/lib/supabase";
import { useAuthSession } from "@/lib/use-auth-session";

export function AccountChip() {
  const { ready, user } = useAuthSession();
  const [busy, setBusy] = useState(false);

  if (!isSupabaseConfigured()) return null;

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setBusy(false);
  }

  if (!ready) {
    return <p className="account-chip no-print">Checking account…</p>;
  }

  if (!user) {
    return (
      <p className="account-chip no-print">
        <Link href="/#account">Sign in to save under your account</Link>
      </p>
    );
  }

  return (
    <div className="account-chip no-print">
      <span>{user.email ?? "Signed in"}</span>
      <Button variant="outline" size="xs" disabled={busy} onClick={() => void handleSignOut()}>
        Sign out
      </Button>
    </div>
  );
}
