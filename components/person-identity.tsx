"use client";

import { displayName, hasDistinctEmail } from "@/lib/names";
import { personRoleLabel, type UserProfile } from "@/lib/roles";

type PersonIdentityProps = {
  person: Pick<UserProfile, "full_name" | "email"> &
    Partial<Pick<UserProfile, "role" | "custom_role_name">>;
  className?: string;
  showEmail?: boolean;
  /** Job title / role under the name (e.g. Sales Rep). */
  showTitle?: boolean;
};

export function PersonIdentity({
  person,
  className,
  showEmail = true,
  showTitle = false,
}: PersonIdentityProps) {
  const name = displayName(person);
  const email = person.email?.trim() ?? "";
  const title =
    showTitle && (person.role || person.custom_role_name)
      ? personRoleLabel(person as Pick<UserProfile, "role" | "custom_role_name">)
      : "";
  return (
    <div className={className ? `person-identity ${className}` : "person-identity"}>
      <strong>{name}</strong>
      {title ? <span className="person-title">{title}</span> : null}
      {showEmail && hasDistinctEmail(person) ? <span className="person-email">{email}</span> : null}
    </div>
  );
}
