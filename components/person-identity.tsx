"use client";

import { displayName, hasDistinctEmail } from "@/lib/names";

type PersonIdentityProps = {
  person: { full_name?: string | null; email?: string | null };
  className?: string;
};

export function PersonIdentity({ person, className }: PersonIdentityProps) {
  const name = displayName(person);
  const email = person.email?.trim() ?? "";
  return (
    <div className={className ? `person-identity ${className}` : "person-identity"}>
      <strong>{name}</strong>
      {hasDistinctEmail(person) ? <span className="person-email">{email}</span> : null}
    </div>
  );
}
