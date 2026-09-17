"use client";

import { useMemo } from "react";
import { useOrg } from "@/lib/org-store";
import { classifyReviewItems } from "@/lib/rep-review";
import { hasActiveRepPush, reviewTargetsFromRows } from "@/lib/sheet-compare";
import { unreadSheetPushes } from "@/lib/push-review";
import { useUserNotifications } from "@/lib/notification-store";
import { isAwaitingRepAction, isPayPeriodLockedForRep } from "@/lib/approval-chain";

export function useRepPendingPush() {
  const org = useOrg();
  const { unread } = useUserNotifications();
  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const targets = useMemo(() => reviewTargetsFromRows(mine), [mine]);
  const unreadPushes = useMemo(() => unreadSheetPushes(unread), [unread]);
  const chain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const pending = Boolean(
    org.profile?.role === "rep" &&
      !isPayPeriodLockedForRep(chain?.status) &&
      (hasActiveRepPush(mine) ||
        targets.length > 0 ||
        unreadPushes.length > 0 ||
        isAwaitingRepAction(chain?.status)),
  );
  return { mine, targets, pending, classified: classifyReviewItems(mine), unreadPushes };
}
