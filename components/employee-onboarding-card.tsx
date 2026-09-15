"use client";

import { useState } from "react";
import { Copy, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/collapsible-card";
import { useOrg } from "@/lib/org-store";
import {
  DEFAULT_APP_URL,
  EMPLOYEE_GUIDE_COPIED_MESSAGE,
  copyTextToClipboard,
  employeeOnboardingEmailText,
  employeeOnboardingSections,
  guideAppUrl,
  guideDealershipName,
  guideJoinCode,
} from "@/lib/employee-onboarding";

const PRINT_CLASS = "print-rep-guide";

function printRepGuide() {
  document.body.classList.add(PRINT_CLASS);
  const cleanup = () => {
    document.body.classList.remove(PRINT_CLASS);
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 800);
}

function GuideOpenUrlStep({ appUrl }: { appUrl: string }) {
  const href = guideAppUrl(appUrl);
  return (
    <p className="rep-guide-open-step">
      <span className="rep-guide-open-num">1. </span>
      Go to:{" "}
      <a className="rep-guide-app-url" href={href} target="_blank" rel="noreferrer">
        {href}
      </a>{" "}
      on your phone or desktop browser.
    </p>
  );
}

function GuideBody({
  orgName,
  joinCode,
  appUrl,
}: {
  orgName: string;
  joinCode: string;
  appUrl: string;
}) {
  const sections = employeeOnboardingSections({ orgName, joinCode });
  return (
    <div className="rep-guide-body">
      <GuideOpenUrlStep appUrl={appUrl} />
      {sections.map((section, index) => (
        <section key={section.title} className="rep-guide-section">
          <h3>
            {index + 2}. {section.title}
          </h3>
          <ol>
            {section.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function EmployeeOnboardingCard() {
  const org = useOrg();
  const orgName = org.organization?.name ?? "";
  const joinCode = org.organization?.join_code ?? "";
  const appUrl = DEFAULT_APP_URL;
  const displayName = guideDealershipName(orgName);
  const displayCode = guideJoinCode(joinCode);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");

  async function handleCopy() {
    setError("");
    const ok = await copyTextToClipboard(employeeOnboardingEmailText({ orgName, joinCode, appUrl }));
    if (!ok) {
      setError("Could not copy the guide. Select the text and copy it manually.");
      return;
    }
    setToast(EMPLOYEE_GUIDE_COPIED_MESSAGE);
    window.setTimeout(() => {
      setToast((value) => (value === EMPLOYEE_GUIDE_COPIED_MESSAGE ? "" : value));
    }, 2800);
  }

  return (
    <>
      <CollapsibleCard
        title="Employee Onboarding Guide"
        className="rep-onboarding-card"
        headerActions={
          <>
            <Button type="button" variant="outline" size="sm" onClick={() => printRepGuide()}>
              <Printer data-icon="inline-start" />
              Print Rep Guide
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()}>
              <Copy data-icon="inline-start" />
              Copy Email Text
            </Button>
          </>
        }
      >
        <p className="empty-note">
          Share this with new sales reps. The Dealership Share Code below is live for{" "}
          <strong>{displayName}</strong>: <span className="rep-guide-inline-code">{displayCode}</span>.
        </p>
        <GuideBody orgName={orgName} joinCode={joinCode} appUrl={appUrl} />
        {toast ? (
          <p className="form-success update-toast" role="status">
            {toast}
          </p>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
      </CollapsibleCard>
      <article className="rep-onboarding-print" aria-hidden="true">
        <header className="rep-guide-print-masthead">
          <p className="rep-guide-dealership">{displayName}</p>
          <p className="rep-guide-code">Dealership share code: {displayCode}</p>
          <h1>Employee Quick-Start Guide</h1>
        </header>
        <GuideBody orgName={orgName} joinCode={joinCode} appUrl={appUrl} />
      </article>
    </>
  );
}
