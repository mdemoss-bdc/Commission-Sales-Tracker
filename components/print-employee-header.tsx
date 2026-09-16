"use client";

import { printSheetEmployee } from "@/lib/print-employee";
import { useOrg } from "@/lib/org-store";
import { useEntryRepId } from "@/lib/tracker-store";
import { useAuthSession } from "@/lib/use-auth-session";
import type { UserProfile } from "@/lib/roles";

type PrintPerson = Pick<UserProfile, "full_name" | "email" | "role" | "location_id">;

export function PrintEmployeeHeader({
  person,
  alwaysShow = false,
}: {
  person?: PrintPerson | null;
  alwaysShow?: boolean;
}) {
  const org = useOrg();
  const entryRepId = useEntryRepId();
  const { user } = useAuthSession();
  const entryRep = person ?? (entryRepId ? org.people.find((row) => row.id === entryRepId) ?? null : null);
  const info = printSheetEmployee({
    entryRep,
    profile: org.profile,
    session: user,
    locations: org.locations,
  });

  if (!info) return null;

  return (
    <div className={alwaysShow ? "print-employee-header" : "print-employee-header hidden print:block"}>
      <p className="print-employee-name text-2xl font-black uppercase tracking-wide text-black">
        {info.name}
      </p>
      <p className="print-employee-role">{info.subtitle}</p>
    </div>
  );
}
