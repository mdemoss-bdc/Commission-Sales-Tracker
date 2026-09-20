/**
 * Pay plan resolution: dealership/org tiers lock reps; standalone users edit a personal plan.
 * Internal storage uses CommissionTier { min, max, rate, label }.
 * External shape aliases: minUnits, maxUnits, packPercentage.
 */

import {
  COMMISSION_TIERS,
  normalizePayTiers,
  serializePayTiers,
  setRuntimePayTiers,
} from "./commission.ts";
import type { CommissionTier } from "./types.ts";
import type { OrganizationRecord, UserProfile } from "./roles.ts";

export type PayPlanTierConfig = {
  minUnits: number;
  maxUnits: number | null;
  packPercentage: number;
};

export type PayPlanSource = "dealership" | "personal" | "default";

export type ResolvedPayPlan = {
  tiers: CommissionTier[];
  locked: boolean;
  source: PayPlanSource;
  dealershipName: string | null;
};

const PERSONAL_PAY_PLAN_PREFIX = "pay-tracker:personal-pay-plan:";

export function personalPayPlanStorageKey(userId: string | null | undefined): string {
  return `${PERSONAL_PAY_PLAN_PREFIX}${userId?.trim() || "guest"}`;
}

export function toPayPlanTierConfig(tier: CommissionTier): PayPlanTierConfig {
  return {
    minUnits: tier.min,
    maxUnits: Number.isFinite(tier.max) ? tier.max : null,
    packPercentage: Math.round(tier.rate * 10000) / 100,
  };
}

export function fromPayPlanTierConfig(row: PayPlanTierConfig): CommissionTier {
  const min = row.minUnits;
  const max = row.maxUnits == null || !Number.isFinite(row.maxUnits) ? Number.POSITIVE_INFINITY : row.maxUnits;
  const rate = row.packPercentage > 1 ? row.packPercentage / 100 : row.packPercentage;
  const label =
    !Number.isFinite(max)
      ? `${min}+ units`
      : min <= 0
        ? `Fewer than ${max + 1} units`
        : `${min}–${max} units`;
  return { min, max, rate, label };
}

export function hasActiveDealershipPayPlan(
  organization: OrganizationRecord | null | undefined,
): boolean {
  return Boolean(organization?.pay_tiers && organization.pay_tiers.length > 0);
}

/** True when the profile is linked to an org/store that can impose a dealership plan. */
export function isLinkedToDealership(
  profile: Pick<UserProfile, "org_id" | "location_id"> | null | undefined,
  organization: OrganizationRecord | null | undefined,
): boolean {
  if (!profile) return false;
  if (organization) return true;
  return Boolean(profile.org_id || profile.location_id);
}

export function resolvePayPlan(input: {
  organization: OrganizationRecord | null | undefined;
  profile: UserProfile | null | undefined;
  personalTiers?: CommissionTier[] | null;
}): ResolvedPayPlan {
  const org = input.organization ?? null;
  const linked = isLinkedToDealership(input.profile, org);
  if (linked && hasActiveDealershipPayPlan(org)) {
    return {
      tiers: org!.pay_tiers!.map((tier) => ({ ...tier })),
      locked: true,
      source: "dealership",
      dealershipName: org?.name?.trim() || "Dealership",
    };
  }
  const personal = input.personalTiers && input.personalTiers.length > 0 ? input.personalTiers : null;
  if (personal) {
    return {
      tiers: personal.map((tier) => ({ ...tier })),
      locked: false,
      source: "personal",
      dealershipName: null,
    };
  }
  return {
    tiers: COMMISSION_TIERS.map((tier) => ({ ...tier })),
    locked: false,
    source: "default",
    dealershipName: null,
  };
}

export function loadPersonalPayTiers(userId: string | null | undefined): CommissionTier[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(personalPayPlanStorageKey(userId));
    if (!raw) return null;
    const tiers = normalizePayTiers(JSON.parse(raw));
    return tiers.length > 0 ? tiers : null;
  } catch {
    return null;
  }
}

export function savePersonalPayTiers(
  userId: string | null | undefined,
  tiers: CommissionTier[],
): string | null {
  if (typeof window === "undefined") return "Storage unavailable.";
  const normalized = normalizePayTiers(tiers);
  if (normalized.length === 0) return "Add at least one unit tier.";
  try {
    window.localStorage.setItem(
      personalPayPlanStorageKey(userId),
      JSON.stringify(serializePayTiers(normalized)),
    );
    setRuntimePayTiers(normalized);
    return null;
  } catch {
    return "Could not save your pay plan locally.";
  }
}

export function clearPersonalPayTiers(userId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(personalPayPlanStorageKey(userId));
  } catch {
    /* ignore */
  }
}

export function applyResolvedPayTiersToRuntime(plan: ResolvedPayPlan): void {
  setRuntimePayTiers(plan.tiers);
}

export const DEALERSHIP_PAY_PLAN_LOCKED_LABEL = "Dealership Pay Plan (Locked by Admin)";
export const EDIT_PAY_PLAN_LABEL = "Edit Plan";
export const SAVE_PAY_PLAN_LABEL = "Save Pay Plan";
