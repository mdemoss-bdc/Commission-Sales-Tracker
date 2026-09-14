"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { retryCloudSync, setEntryRepId, useEntryRepId } from "@/lib/tracker-store";
import { entryRepsFor, useOrg, useOrgActions } from "@/lib/org-store";
import { displayName, personOptionLabel } from "@/lib/names";
import { canReviewDeals } from "@/lib/roles";

export function EmployeeEntryCard() {
  const org = useOrg();
  const { pushToEmployee } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!org.profile || !canReviewDeals(org.profile.role)) return null;

  const reps = entryRepsFor(org.profile, org.people, org.locationFilterId);
  const selected = reps.find((person) => person.id === entryRepId);
  const draftCount = entryRepId
    ? org.draftsForEntry.filter((row) => row.rep_id === entryRepId).length
    : 0;

  async function handlePush() {
    if (!entryRepId) return;
    setBusy(true);
    setMessage("");
    const error = await pushToEmployee(entryRepId);
    setBusy(false);
    if (error) {
      setMessage(error);
      return;
    }
    setMessage("Pushed to the rep as staged. Their live tracker was not overwritten.");
    retryCloudSync();
  }

  return (
    <section className="summary-card no-print">
      <h2>Employee entry mode</h2>
      <p className="empty-note">
        Choose a sales rep to enter deals on their behalf. Those inputs stay in a staging buffer
        until you push. Pushing does not overwrite their live tracker.
      </p>
      <div className="add-month-form">
        <label>
          Enter deals for
          <select
            value={entryRepId ?? ""}
            onChange={(event) => {
              setMessage("");
              setEntryRepId(event.target.value || null);
            }}
          >
            <option value="">My dashboard</option>
            {reps.map((person) => (
              <option key={person.id} value={person.id}>
                {personOptionLabel(
                  person,
                  person.location_id
                    ? org.locations.find((item) => item.id === person.location_id)?.name
                    : null,
                )}
              </option>
            ))}
          </select>
        </label>
        {entryRepId ? (
          <Button disabled={busy || draftCount === 0} onClick={() => void handlePush()}>
            Push to employee
          </Button>
        ) : null}
      </div>
      {selected ? (
        <p className="empty-note">
          Editing a staging buffer for {displayName(selected)}. {draftCount} unpushed
          staged record{draftCount === 1 ? "" : "s"} ready to send.
        </p>
      ) : null}
      {reps.length === 0 ? (
        <p className="empty-note">
          {org.profile.role === "manager" && !org.profile.location_id
            ? "Ask the admin to assign you to a location before entering deals for a rep."
            : "No sales reps are assigned yet."}
        </p>
      ) : null}
      {message ? <p className={message.includes("Pushed") ? "form-success" : "form-error"}>{message}</p> : null}
    </section>
  );
}
