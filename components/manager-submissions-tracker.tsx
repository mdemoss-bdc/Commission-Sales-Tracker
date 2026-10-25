"use client";

import { CollapsibleCard } from "@/components/collapsible-card";

export function ManagerSubmissionsTracker() {
  return (
    <CollapsibleCard title="Manager Submissions" className="manager-submissions">
      <p className="empty-note">
        No submissions yet. Sheets a manager authorizes and sends back to the
        office will be listed here.
      </p>
    </CollapsibleCard>
  );
}
