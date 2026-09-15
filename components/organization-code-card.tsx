"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/lib/org-store";
import { DEALERSHIP_CODE_COPIED_MESSAGE, dealershipJoinCodeBanner } from "@/lib/signup";

async function copyJoinCode(code: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      return true;
    }
  } catch {
    /* fall through to execCommand */
  }
  try {
    const field = document.createElement("textarea");
    field.value = code;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    return ok;
  } catch {
    return false;
  }
}

export function OrganizationCodeCard() {
  const org = useOrg();
  const current = org.organization;
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  if (!current) {
    return (
      <section className="summary-card no-print">
        <h2>Dealership Share Code</h2>
        <p className="empty-note">
          Re-run supabase/schema.sql in the SQL editor to enable the dealership group join code.
        </p>
      </section>
    );
  }

  async function handleCopy() {
    if (!current) return;
    setError("");
    const ok = await copyJoinCode(current.join_code);
    if (!ok) {
      setError("Could not copy the code. Select it and copy manually.");
      return;
    }
    setToast(DEALERSHIP_CODE_COPIED_MESSAGE);
    window.setTimeout(() => {
      setToast((value) => (value === DEALERSHIP_CODE_COPIED_MESSAGE ? "" : value));
    }, 2800);
  }

  return (
    <section className="summary-card no-print org-share-card">
      <h2>Dealership Share Code</h2>
      <p className="org-share-code" aria-label={dealershipJoinCodeBanner(current.join_code)}>
        {dealershipJoinCodeBanner(current.join_code)}
      </p>
      <p className="empty-note">
        Employees will enter this code when signing up to connect to your dealership.
      </p>
      <Button type="button" onClick={() => void handleCopy()}>
        <Copy data-icon="inline-start" />
        Copy Code
      </Button>
      {toast ? (
        <p className="form-success update-toast" role="status">
          {toast}
        </p>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
