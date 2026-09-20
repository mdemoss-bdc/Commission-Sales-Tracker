"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAvailableOrgLocations } from "@/lib/org";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { activeStoreChangedMessage } from "@/lib/assignment";
import { setEntryRepId, useEntryRepId } from "@/lib/tracker-store";
import { matchesLocationFilter } from "@/lib/locations";
import type { LocationRecord } from "@/lib/roles";

export function ActiveStorePicker() {
  const org = useOrg();
  const { switchOwnLocation, leaveDealership } = useOrgActions();
  const entryRepId = useEntryRepId();
  const [stores, setStores] = useState<LocationRecord[]>(org.locations);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setStores([...org.locations].sort((a, b) => a.name.localeCompare(b.name)));
  }, [org.locations]);

  useEffect(() => {
    let cancelled = false;
    void getAvailableOrgLocations().then((rows) => {
      if (cancelled) return;
      setStores([...rows].sort((a, b) => a.name.localeCompare(b.name)));
    });
    return () => {
      cancelled = true;
    };
  }, [org.profile?.org_id, org.locations.length]);

  useEffect(() => {
    if (!confirmOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setConfirmOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, confirmOpen]);

  if (!org.profile) return null;

  const currentId = org.profile.location_id ?? "";
  const noStores = stores.length === 0;
  const currentStore =
    stores.find((store) => store.id === currentId) ??
    org.locations.find((store) => store.id === currentId) ??
    null;
  const dealershipName = org.organization?.name?.trim() || currentStore?.name || "this dealership";
  const canDisconnect = org.profile.role === "rep" && Boolean(org.profile.location_id || org.profile.org_id);

  async function handleChange(nextId: string) {
    if (!nextId || nextId === currentId) return;
    const store = stores.find((item) => item.id === nextId);
    if (!store) return;
    setBusy(true);
    setError("");
    const message = await switchOwnLocation(nextId);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    if (entryRepId) {
      const selected = org.people.find((person) => person.id === entryRepId);
      if (selected && !matchesLocationFilter(selected.location_id, nextId)) {
        setEntryRepId(null);
      }
    }
    const note = activeStoreChangedMessage(store.name);
    setToast(note);
    window.setTimeout(() => {
      setToast((current) => (current === note ? "" : current));
    }, 2800);
  }

  async function handleConfirmDisconnect() {
    setBusy(true);
    setError("");
    const message = await leaveDealership();
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    setConfirmOpen(false);
    setToast("Disconnected. You can join another dealership anytime with a share code.");
    window.setTimeout(() => setToast(""), 3200);
  }

  return (
    <div className="store-picker">
      <label className="store-picker-label">
        <MapPin aria-hidden="true" />
        <span>Store:</span>
        <select
          value={stores.some((store) => store.id === currentId) ? currentId : ""}
          disabled={busy || noStores}
          aria-label="Active store"
          onChange={(event) => {
            void handleChange(event.target.value);
          }}
        >
          {noStores ? (
            <option value="">No stores yet</option>
          ) : stores.some((store) => store.id === currentId) ? null : (
            <option value="" disabled>
              Select a store
            </option>
          )}
          {stores.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
      </label>
      {canDisconnect ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="leave-dealership-btn"
          disabled={busy}
          onClick={() => {
            setError("");
            setConfirmOpen(true);
          }}
        >
          Disconnect from Dealership
        </Button>
      ) : null}
      {toast ? (
        <p className="store-picker-toast" role="status">
          {toast}
        </p>
      ) : null}
      {error && !confirmOpen ? (
        <p className="store-picker-error" role="alert">
          {error}
        </p>
      ) : null}

      {confirmOpen ? (
        <div
          className="account-modal-backdrop no-print"
          role="presentation"
          onClick={() => (busy ? undefined : setConfirmOpen(false))}
        >
          <div
            className="account-modal max-w-md w-[94vw]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="leave-dealership-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="account-modal-head">
              <div>
                <p className="workbook-kicker">Dealership</p>
                <h2 id="leave-dealership-title">Disconnect from {dealershipName}?</h2>
              </div>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Close
              </Button>
            </div>
            <p className="empty-note">
              You will be unlinked from this store roster and will no longer receive pushed pay sheets from management.
              Your past personal deals and working sheets will remain saved to your personal account. You can reconnect
              to another dealership at any time using their Dealership Share Code.
            </p>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="cloud-setup-actions">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="leave-dealership-confirm"
                disabled={busy}
                onClick={() => void handleConfirmDisconnect()}
              >
                {busy ? "Disconnecting…" : "Confirm Disconnect"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
