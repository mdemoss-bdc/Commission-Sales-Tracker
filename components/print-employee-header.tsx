"use client";

import { printSheetEmployee } from "@/lib/print-employee";
import { useOrg } from "@/lib/org-store";
import { useEntryRepId } from "@/lib/tracker-store";
import { useAuthSession } from "@/lib/use-auth-session";

export function PrintEmployeeHeader() {
  const org = useOrg();
  const entryRepId = useEntryRepId();
  const { user } = useAuthSession();
  const entryRep = entryRepId ? org.people.find((person) => person.id === entryRepId) ?? null : null;
  const info = printSheetEmployee({
    entryRep,
    profile: org.profile,
    session: user,
    locations: org.locations,
  });

  if (!info) return null;

  return (
    <div className="print-employee-header hidden print:block">
      <p className="print-employee-name text-2xl font-black uppercase tracking-wide text-black">
        {info.name}
      </p>
      <p className="print-employee-role">{info.subtitle}</p>
    </div>
  );
}
