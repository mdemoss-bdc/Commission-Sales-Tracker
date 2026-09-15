"use client";

import { isSupabaseConfigured } from "@/lib/supabase";
import { useCloudStatus } from "@/lib/tracker-store";
import { useAuthSession } from "@/lib/use-auth-session";

export function CloudStatusCard() {
  const status = useCloudStatus();
  const { user } = useAuthSession();

  if (!isSupabaseConfigured() || !user) return null;
  if (status === "syncing") {
    return <p className="cloud-status-note no-print">Saving to your account…</p>;
  }
  if (status === "signed-out") return null;
  return (
    <p id="account" className="cloud-status-note no-print">
      Saved to your account ({user.email ?? user.id.slice(0, 8)}) and this browser.
    </p>
  );
}
