"use client";

import { managerSubmissionSummary, type ManagerStoreStatus } from "@/lib/manager-status";
import { setLocationFilter } from "@/lib/org-store";
import { CollapsibleCard } from "@/components/collapsible-card";

export function ManagerSubmissionsTracker({ rows }: { rows: ManagerStoreStatus[] }) {
  const { completeCount, pendingCount } = managerSubmissionSummary(rows);

  return (
    <CollapsibleCard
      title={`Manager Submissions (${completeCount} Complete, ${pendingCount} Pending)`}
      defaultOpen
      className="manager-submissions"
    >
      <p className="empty-note">
        One row per store. Red means a sheet is still with the rep or waiting on manager audit.
        Green means the manager approved to Admin — either the original admin baseline (Accepted,
        No Changes) or the overwritten rep draft (Approved / Finalized (Updated)). Open a store
        to audit the payroll-ready worksheet.
      </p>
      {rows.length === 0 ? (
        <p className="empty-note">Add a location to track manager submissions by store.</p>
      ) : (
        <ul className="org-list">
          {rows.map((row) => (
            <li key={row.locationId}>
              <button
                type="button"
                className={
                  row.complete
                    ? "manager-status-card manager-status-complete"
                    : "manager-status-card manager-status-pending"
                }
                onClick={() => setLocationFilter(row.locationId)}
              >
                <div>
                  <strong>{row.storeName}</strong>
                  <p className="empty-note">{row.managerLabel}</p>
                  <p className="empty-note">{row.pendingLabel}</p>
                </div>
                <span
                  className={
                    row.complete
                      ? "roster-badge roster-badge-ready"
                      : "roster-badge manager-status-badge-pending"
                  }
                >
                  {row.complete ? "Complete / Submitted" : "Pending Submissions"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  );
}
