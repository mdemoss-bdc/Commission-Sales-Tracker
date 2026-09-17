"use client";

import { useEffect, useMemo, useState } from "react";
import { useOrg } from "@/lib/org-store";
import { classifyReviewItems } from "@/lib/rep-review";
import { hasActiveRepPush, reviewTargetsFromRows } from "@/lib/sheet-compare";
import {
  clearPushReviewSession,
  isAdminLedgerActivelyPushed,
  unreadSheetPushes,
} from "@/lib/push-review";
import { useUserNotifications } from "@/lib/notification-store";
import { isAwaitingRepAction, isPayPeriodLockedForRep } from "@/lib/approval-chain";
import { isPaidAdminSheet, loadAdminEmployeeSheet, loadMyAdminSheetLockStatus } from "@/lib/admin-employee-sheets";
import { activePayPeriod } from "@/lib/pay-period";

export function useRepPendingPush() {
  const org = useOrg();
  const { unread } = useUserNotifications();
  const [ledgerLocked, setLedgerLocked] = useState(false);
  const [adminLedgerActive, setAdminLedgerActive] = useState<boolean | null>(null);
  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const targets = useMemo(() => reviewTargetsFromRows(mine), [mine]);
  const unreadPushes = useMemo(() => unreadSheetPushes(unread), [unread]);
  const chain = org.approvalChains.find((row) => row.employeeId === org.profile?.id);
  const periodKey = chain?.monthId ?? activePayPeriod().key ?? "";

  useEffect(() => {
    if (org.profile?.role !== "rep" || !org.profile.id) {
      setLedgerLocked(false);
      setAdminLedgerActive(null);
      return;
    }
    const userId = org.profile.id;
    let cancelled = false;
    void (async () => {
      const [lockRow, sheetLoad] = await Promise.all([
        loadMyAdminSheetLockStatus(periodKey || null),
        loadAdminEmployeeSheet(userId, periodKey || null),
      ]);
      if (cancelled) return;
      setLedgerLocked(
        Boolean(
          lockRow &&
            (lockRow.isPaid ||
              isPaidAdminSheet(lockRow.status, lockRow.isPaid) ||
              isPayPeriodLockedForRep(lockRow.status)),
        ),
      );
      if (sheetLoad.status === "missing" || sheetLoad.status === "error") {
        setAdminLedgerActive(null);
        return;
      }
      const active = isAdminLedgerActivelyPushed(sheetLoad.row);
      setAdminLedgerActive(active);
      if (!sheetLoad.row || !active) {
        clearPushReviewSession(userId, periodKey || "legacy");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [org.profile?.role, org.profile?.id, org.allDeals, org.approvalChains, periodKey]);

  const pending = Boolean(
    org.profile?.role === "rep" &&
      !ledgerLocked &&
      adminLedgerActive !== false &&
      !isPayPeriodLockedForRep(chain?.status) &&
      !mine.some((row) => isPayPeriodLockedForRep(row.status)) &&
      (hasActiveRepPush(mine) ||
        targets.length > 0 ||
        unreadPushes.length > 0 ||
        isAwaitingRepAction(chain?.status)),
  );
  return {
    mine,
    targets,
    pending,
    classified: classifyReviewItems(mine),
    unreadPushes,
    adminLedgerActive,
  };
}
