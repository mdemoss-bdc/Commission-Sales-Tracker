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
        One row per store. Red means reps still have unsubmitted sheets or the manager has not
        approved them. Green means every rep at that store has been pushed and locked into live
        records. Open a store to audit the live worksheets. Admins no longer authorize deals.
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
