import type { CommissionTier } from "./types.ts";

export type UserRole = "admin" | "manager" | "rep";
export type RecordStatus =
  | "active"
  | "draft"
  | "staged"
  | "pending_rep_review"
  | "pending_manager_approval"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

export function isLiveRecordStatus(status: RecordStatus | string | null | undefined): boolean {
  return status === "active" || status === "approved";
}

export function isPipelineRecordStatus(status: RecordStatus | string | null | undefined): boolean {
  return (
    status === "draft" ||
    status === "staged" ||
    status === "pending_rep_review" ||
    status === "pending_manager_approval" ||
    status === "pending_admin_approval"
  );
}

export type LocationRecord = {
  id: string;
  name: string;
  created_at?: string;
  org_id?: string | null;
};

export type OrganizationRecord = {
  id: string;
  name: string;
  join_code: string;
  pay_tiers?: CommissionTier[];
};

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  location_id: string | null;
  org_id?: string | null;
  roster_ready?: boolean;
};

export function roleLabel(role: UserRole): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return "Sales Rep";
}

export function roleBadge(role: UserRole): string {
  return `[${roleLabel(role)}]`;
}

/**
 * Header badge when signed in. If no profile row can be loaded because the
 * tables are missing, treat this as the first user (admin). Otherwise later
 * accounts default to sales rep until the real profile arrives.
 */
export function signedInRoleBadge(role: UserRole | null | undefined, tablesMissing: boolean): string {
  if (role) return roleBadge(role);
  return roleBadge(firstUserRole(!tablesMissing));
}

/** First account in the org is admin; every later signup is a sales rep. */
export function firstUserRole(adminExists: boolean): UserRole {
  return adminExists ? "rep" : "admin";
}

/** Dealership-code signup with a chosen rooftop is always a locked sales rep. */
export function signupRole(adminExists: boolean, selectedLocationId?: string | null): UserRole {
  if (selectedLocationId?.trim()) return "rep";
  return firstUserRole(adminExists);
}

export function canManageOrg(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function canReviewDeals(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export const PROTECTED_ADMIN_EMAIL = "matthewdemoss@mosescars.com";

export function isProtectedAdminEmail(email?: string | null): boolean {
  return (email ?? "").trim().toLowerCase() === PROTECTED_ADMIN_EMAIL;
}

/** Prefer the database role. The owner email is always Admin and is never guessed as Sales Rep. */
export function resolvedProfileRole(
  email: string | null | undefined,
  role: UserRole | string | null | undefined,
): UserRole {
  if (isProtectedAdminEmail(email)) return "admin";
  if (role === "admin" || role === "manager" || role === "rep") return role;
  return "rep";
}

export function canEditPersonRole(actor: UserProfile | null | undefined, target: UserProfile): boolean {
  if (!actor || !canManageOrg(actor.role)) return false;
  if (actor.id === target.id) return false;
  if (isProtectedAdminEmail(target.email)) return false;
  return true;
}

export function roleUpdatedMessage(name: string, role: UserRole): string {
  return `Updated ${name} to ${roleLabel(role)}.`;
}
