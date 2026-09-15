import type { CommissionTier } from "./types.ts";

export type UserRole = "admin" | "manager" | "rep";
export type RecordStatus =
  | "active"
  | "draft"
  | "staged"
  | "pending_rep_review"
  | "awaiting_review"
  | "pushed"
  | "pending_manager_approval"
  | "pending_admin_approval"
  | "approved"
  | "rejected";

export function isPushedSheetStatus(status: RecordStatus | string | null | undefined): boolean {
  return (
    status === "pushed" ||
    status === "awaiting_review" ||
    status === "pending_rep_review" ||
    status === "staged"
  );
}

export function isLiveRecordStatus(status: RecordStatus | string | null | undefined): boolean {
  return status === "active" || status === "approved";
}

export function isPipelineRecordStatus(status: RecordStatus | string | null | undefined): boolean {
  return (
    status === "draft" ||
    status === "staged" ||
    status === "pending_rep_review" ||
    status === "awaiting_review" ||
    status === "pushed" ||
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
  custom_role_id?: string | null;
  custom_role_name?: string | null;
};

export type CustomRole = {
  id: string;
  org_id: string;
  name: string;
};

export const BUILT_IN_ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "rep", label: "Sales Rep" },
];

export function roleLabel(role: UserRole): string {
  if (role === "admin") return "Admin";
  if (role === "manager") return "Manager";
  return "Sales Rep";
}

export function roleBadge(role: UserRole): string {
  return `[${roleLabel(role)}]`;
}

/**
 * Header badge when signed in. Missing profile tables never imply Admin —
 * join-code accounts are sales reps until the real profile arrives.
 */
export function signedInRoleBadge(role: UserRole | null | undefined, _tablesMissing?: boolean): string {
  if (role) return roleBadge(role);
  return roleBadge("rep");
}

export function profileMatchesSession(
  profile: Pick<UserProfile, "id"> | null | undefined,
  userId: string | null | undefined,
): boolean {
  return Boolean(profile && userId && profile.id === userId);
}

/** Role chip only after the current auth user's profile has loaded. Never a prior session. */
export function visibleRoleBadge(
  profile: Pick<UserProfile, "id" | "role" | "custom_role_name"> | null | undefined,
  userId: string | null | undefined,
  isLoadingProfile = false,
): string | null {
  if (isLoadingProfile) return null;
  if (!profileMatchesSession(profile, userId) || !profile) return null;
  return `[${personRoleLabel(profile)}]`;
}

/** Dealership join-code signup is always a sales rep. Never the first-store admin. */
export function signupRole(_adminExists?: boolean, _selectedLocationId?: string | null): UserRole {
  return "rep";
}

export function personRoleLabel(person: Pick<UserProfile, "role" | "custom_role_name">): string {
  const custom = person.custom_role_name?.trim();
  if (custom) return custom;
  return roleLabel(person.role);
}

export function canManageOrg(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function canReviewDeals(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}

export const PROTECTED_ADMIN_EMAIL = "matthewdemoss@mosescars.com";
export const JOIN_CODE_SALES_REP_EMAIL = "matthewdemoss@gmail.com";

export function isProtectedAdminEmail(email?: string | null): boolean {
  return (email ?? "").trim().toLowerCase() === PROTECTED_ADMIN_EMAIL;
}

export function isJoinCodeSalesRepEmail(email?: string | null): boolean {
  return (email ?? "").trim().toLowerCase() === JOIN_CODE_SALES_REP_EMAIL;
}

/** Prefer the database role. Moses Cars owner email stays Admin. Join-code Gmail is never guessed as Admin. */
export function resolvedProfileRole(
  email: string | null | undefined,
  role: UserRole | string | null | undefined,
): UserRole {
  if (isProtectedAdminEmail(email)) return "admin";
  if (isJoinCodeSalesRepEmail(email) && role !== "admin" && role !== "manager") return "rep";
  if (role === "admin" || role === "manager" || role === "rep") return role;
  return "rep";
}

export function canEditPersonRole(actor: UserProfile | null | undefined, target: UserProfile): boolean {
  if (!actor || !canManageOrg(actor.role)) return false;
  if (actor.id === target.id) return false;
  if (isProtectedAdminEmail(target.email)) return false;
  return true;
}

export const CUSTOM_ROLE_VALUE_PREFIX = "custom:";

export function personRoleSelectValue(person: Pick<UserProfile, "role" | "custom_role_id">): string {
  if (person.custom_role_id) return `${CUSTOM_ROLE_VALUE_PREFIX}${person.custom_role_id}`;
  return person.role;
}

export function parsePersonRoleSelect(value: string): { role: UserRole; customRoleId: string | null } {
  if (value.startsWith(CUSTOM_ROLE_VALUE_PREFIX)) {
    const customRoleId = value.slice(CUSTOM_ROLE_VALUE_PREFIX.length).trim();
    return { role: "rep", customRoleId: customRoleId || null };
  }
  if (value === "admin" || value === "manager" || value === "rep") {
    return { role: value, customRoleId: null };
  }
  return { role: "rep", customRoleId: null };
}

export function normalizeCustomRoleName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function canAddCustomRole(name: string, existing: Array<Pick<CustomRole, "name">>): string | null {
  const cleaned = normalizeCustomRoleName(name);
  if (cleaned.length < 2) return "Enter a role name.";
  const lower = cleaned.toLowerCase();
  if (BUILT_IN_ROLE_OPTIONS.some((item) => item.label.toLowerCase() === lower)) {
    return "That name is already a built-in role.";
  }
  if (existing.some((item) => item.name.trim().toLowerCase() === lower)) {
    return "That role already exists.";
  }
  return null;
}

export function roleUpdatedMessage(name: string, role: UserRole): string {
  return `Updated ${name} to ${roleLabel(role)}.`;
}
