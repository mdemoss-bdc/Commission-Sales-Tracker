"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-session";
import { useOrg } from "@/lib/org-store";
import { signedInRoleBadge } from "@/lib/roles";
import { useAuthSession } from "@/lib/use-auth-session";

export function AccountChip() {
  const { user } = useAuthSession();
  const org = useOrg();
  const profile = org.profile;
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setBusy(false);
  }

  const badge =
    profile || org.ready ? signedInRoleBadge(profile?.role, !profile) : null;

  return (
    <div className="account-chip no-print">
      <span className="account-email">{user.email ?? "Signed in"}</span>
      {badge ? <span className="role-badge">{badge}</span> : null}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleSignOut()}>
        Sign Out
      </Button>
    </div>
  );
}
