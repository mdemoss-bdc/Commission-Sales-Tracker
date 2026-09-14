"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth-session";
import { useOrg } from "@/lib/org-store";
import { roleBadge } from "@/lib/roles";
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

  return (
    <div className="account-chip no-print">
      <span className="account-email">{user.email ?? "Signed in"}</span>
      {profile ? <span className="role-badge">{roleBadge(profile.role)}</span> : null}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleSignOut()}>
        Sign Out
      </Button>
    </div>
  );
}
