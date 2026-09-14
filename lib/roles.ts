export type UserRole = "admin" | "manager" | "rep";
export type RecordStatus =
  | "active"
  | "draft"
  | "staged"
  | "pending_rep_review"
  | "pending_manager_approval"
  | "approved"
  | "rejected";

export type LocationRecord = {
  id: string;
  name: string;
  created_at?: string;
};

export type UserProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  location_id: string | null;
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

export function canManageOrg(role: UserRole | null | undefined): boolean {
  return role === "admin";
}

export function canReviewDeals(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "manager";
}
