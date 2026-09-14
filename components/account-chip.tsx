"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AccountSettingsModal } from "@/components/account-settings-modal";
import { signOut } from "@/lib/auth-session";
import { displayName } from "@/lib/names";
import { useOrg } from "@/lib/org-store";
import { signedInRoleBadge } from "@/lib/roles";
import { useAuthSession } from "@/lib/use-auth-session";

export function AccountChip() {
  const { user } = useAuthSession();
  const org = useOrg();
  const profile = org.profile;
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!user) return null;

  const shownName = displayName({
    full_name: profile?.full_name ?? user.fullName,
    email: user.email,
  });

  const badge = profile || org.ready ? signedInRoleBadge(profile?.role, !profile) : null;

  async function handleSignOut() {
    setBusy(true);
    await signOut();
    setBusy(false);
  }

  return (
    <div className="account-chip no-print">
      <button type="button" className="account-name-btn" onClick={() => setSettingsOpen(true)}>
        {shownName}
      </button>
      {badge ? <span className="role-badge">{badge}</span> : null}
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleSignOut()}>
        Sign Out
      </Button>
      <AccountSettingsModal open={settingsOpen} user={user} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
