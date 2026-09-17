"use client";

import { useEffect, useMemo, useState } from "react";
import { useOrg } from "@/lib/org-store";
import { classifyReviewItems } from "@/lib/rep-review";
import { hasActiveRepPush, reviewTargetsFromRows } from "@/lib/sheet-compare";
import { unreadSheetPushes } from "@/lib/push-review";
import { useUserNotifications } from "@/lib/notification-store";
import { isAwaitingRepAction, isPayPeriodLockedForRep } from "@/lib/approval-chain";
import { isPaidAdminSheet, loadMyAdminSheetLockStatus } from "@/lib/admin-employee-sheets";

export function useRepPendingPush() {
  const org = useOrg();
  const { unread } = useUserNotifications();
  const [ledgerLocked, setLedgerLocked] = useState(false);
  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const targets = useMemo(() => reviewTargetsFromRows(mine), [mine]);
  const unreadPushes = useMemo(() => unreadSheetPushes(unread), [unread]);
  const chain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);

  useEffect(() => {
    if (org.profile?.role !== "rep") {
      setLedgerLocked(false);
      return;
    }
    let cancelled = false;
    void loadMyAdminSheetLockStatus(null).then((row) => {
      if (cancelled) return;
      setLedgerLocked(
        Boolean(row && (row.isPaid || isPaidAdminSheet(row.status, row.isPaid) || isPayPeriodLockedForRep(row.status))),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [org.profile?.role, org.profile?.id]);

  const pending = Boolean(
    org.profile?.role === "rep" &&
      !ledgerLocked &&
      !isPayPeriodLockedForRep(chain?.status) &&
      !mine.some((row) => isPayPeriodLockedForRep(row.status)) &&
      (hasActiveRepPush(mine) ||
        targets.length > 0 ||
        unreadPushes.length > 0 ||
        isAwaitingRepAction(chain?.status)),
  );
  return { mine, targets, pending, classified: classifyReviewItems(mine), unreadPushes };
}
