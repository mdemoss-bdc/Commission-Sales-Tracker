"use client";

import { useMemo } from "react";
import { useOrg } from "@/lib/org-store";
import { classifyReviewItems } from "@/lib/rep-review";
import { hasActiveRepPush, reviewTargetsFromRows } from "@/lib/sheet-compare";

export function useRepPendingPush() {
  const org = useOrg();
  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const targets = useMemo(() => reviewTargetsFromRows(mine), [mine]);
  const pending = Boolean(org.profile?.role === "rep" && (hasActiveRepPush(mine) || targets.length > 0));
  return { mine, targets, pending, classified: classifyReviewItems(mine) };
}
