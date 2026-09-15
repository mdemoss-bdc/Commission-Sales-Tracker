"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lookupStoresByOrgCode } from "@/lib/org";
import { useOrg, useOrgActions } from "@/lib/org-store";
import {
  JOIN_DEALERSHIP_BANNER,
  joinedDealershipMessage,
  needsDealershipLink,
  normalizeOrgCode,
  type OrgCodeLookup,
} from "@/lib/signup";
import type { LocationRecord } from "@/lib/roles";

const modalListeners = new Set<(open: boolean) => void>();
const toastListeners = new Set<() => void>();
let joinToast = "";
let joinToastTimer: ReturnType<typeof setTimeout> | undefined;

export function openJoinDealershipModal() {
  for (const listener of modalListeners) listener(true);
}

export function getJoinDealershipToast() {
  return joinToast;
}

export function subscribeJoinDealershipToast(listener: () => void) {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

function showJoinToast(message: string) {
  joinToast = message;
  for (const listener of toastListeners) listener();
  if (joinToastTimer) clearTimeout(joinToastTimer);
  joinToastTimer = setTimeout(() => {
    joinToast = "";
    for (const listener of toastListeners) listener();
  }, 3200);
}

function useBrowserDocument(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function JoinDealershipToast() {
  const toast = useSyncExternalStore(subscribeJoinDealershipToast, getJoinDealershipToast, () => "");
  if (!toast) return null;
  return (
    <p className="store-picker-toast" role="status">
      {toast}
    </p>
  );
}

export function JoinDealershipBanner() {
  const org = useOrg();
  if (!org.ready || org.isLoadingProfile || !needsDealershipLink(org.profile)) return null;
  return (
    <section className="summary-card no-print join-dealership-banner" aria-live="polite">
      <h2>Connect to Dealership</h2>
      <p className="empty-note">{JOIN_DEALERSHIP_BANNER}</p>
      <Button type="button" onClick={() => openJoinDealershipModal()}>
        Join Dealership
      </Button>
    </section>
  );
}

export function JoinDealershipHeaderButton() {
  const org = useOrg();
  if (!org.ready || org.isLoadingProfile || !needsDealershipLink(org.profile)) return null;
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => openJoinDealershipModal()}>
      Join Dealership
    </Button>
  );
}

export function JoinDealershipHost() {
  const org = useOrg();
  const { joinDealership } = useOrgActions();
  const canPortal = useBrowserDocument();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const [orgCode, setOrgCode] = useState("");
  const [orgLookup, setOrgLookup] = useState<OrgCodeLookup | null>(null);
  const [orgCodeError, setOrgCodeError] = useState("");
  const [orgCodeChecking, setOrgCodeChecking] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lookupTimer = useRef<number | null>(null);
  const lookupRequest = useRef(0);
  const connectedStores: LocationRecord[] = orgLookup?.stores ?? [];
  const canConnect = Boolean(orgLookup && locationId.trim());

  useEffect(() => {
    const listener = (next: boolean) => setOpen(next);
    modalListeners.add(listener);
    return () => {
      modalListeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) closeModal();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy]);

  function resetForm() {
    setOrgCode("");
    setOrgLookup(null);
    setOrgCodeError("");
    setOrgCodeChecking(false);
    setLocationId("");
    setError("");
    setBusy(false);
    lookupRequest.current += 1;
  }

  function closeModal() {
    setOpen(false);
    resetForm();
  }

  async function resolveOrgCode(raw: string) {
    const cleaned = normalizeOrgCode(raw);
    if (!cleaned) {
      setOrgLookup(null);
      setOrgCodeError("");
      setLocationId("");
      setOrgCodeChecking(false);
      return;
    }
    const requestId = ++lookupRequest.current;
    setOrgCodeChecking(true);
    const result = await lookupStoresByOrgCode(cleaned);
    if (requestId !== lookupRequest.current) return;
    setOrgCodeChecking(false);
    if (!result) {
      setOrgLookup(null);
      setLocationId("");
      setOrgCodeError("Invalid dealership code.");
      return;
    }
    setOrgLookup(result);
    setOrgCodeError("");
    setLocationId((current) => (result.stores.some((store) => store.id === current) ? current : ""));
  }

  function scheduleOrgLookup(raw: string) {
    if (lookupTimer.current) window.clearTimeout(lookupTimer.current);
    lookupTimer.current = window.setTimeout(() => {
      void resolveOrgCode(raw);
    }, 400);
  }

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    if (!canConnect) {
      setError("Enter a valid dealership code and select your store.");
      return;
    }
    setBusy(true);
    setError("");
    const result = await joinDealership(orgCode, locationId.trim());
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    closeModal();
    showJoinToast(joinedDealershipMessage(result.orgName));
  }

  if (!canPortal || !open || !org.profile) return null;

  return createPortal(
    <div className="account-modal-backdrop" onClick={() => (busy ? undefined : closeModal())}>
      <section
        className="account-modal join-dealership-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="account-modal-head">
          <div>
            <p className="workbook-kicker">Dealership group</p>
            <h2 id={titleId}>Join Dealership</h2>
            <p className="auth-lead">{JOIN_DEALERSHIP_BANNER}</p>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => closeModal()}>
            Close
          </Button>
        </div>
        <form className="auth-form" onSubmit={(event) => void handleConnect(event)}>
          <label>
            Dealership Code
            <Input
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
              value={orgCode}
              onChange={(event) => {
                const next = normalizeOrgCode(event.target.value).slice(0, 6);
                setOrgCode(next);
                setOrgLookup(null);
                setOrgCodeError("");
                setLocationId("");
                setError("");
                scheduleOrgLookup(next);
              }}
              onBlur={() => void resolveOrgCode(orgCode)}
              placeholder="e.g. 7K9X2B"
              required
            />
          </label>
          {orgCodeChecking ? <p className="empty-note">Checking dealership code…</p> : null}
          {orgLookup ? (
            <p className="signup-org-ok" role="status">
              ✓ Connected to {orgLookup.org_name}
            </p>
          ) : null}
          {orgCodeError ? (
            <p className="signup-org-bad" role="alert">
              ✗ Invalid dealership code.
            </p>
          ) : null}
          {orgLookup ? (
            <label>
              Select Your Location / Store
              <select
                className="auth-select"
                required
                value={locationId}
                disabled={connectedStores.length === 0}
                onChange={(event) => setLocationId(event.target.value)}
              >
                <option value="">Select your dealership store...</option>
                {connectedStores.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {orgLookup && connectedStores.length === 0 ? (
            <p className="form-error">This group has no rooftops yet. Ask an admin to add locations.</p>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          <Button type="submit" disabled={busy || !canConnect}>
            {busy ? "Connecting…" : "Connect Account"}
          </Button>
        </form>
      </section>
    </div>,
    document.body,
  );
}
