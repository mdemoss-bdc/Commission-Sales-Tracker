"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { retryCloudSync } from "@/lib/tracker-store";
import { useOrg, useOrgActions } from "@/lib/org-store";
import { classifyReviewItems } from "@/lib/rep-review";
import { reviewSheetTargets } from "@/lib/sheet-compare";

export function ManagerReviewHost() {
  const org = useOrg();
  const { resolveReview } = useOrgActions();
  const pathname = usePathname();
  const router = useRouter();

  const mine = useMemo(
    () => (org.profile ? org.allDeals.filter((row) => row.rep_id === org.profile?.id) : []),
    [org.allDeals, org.profile],
  );
  const classified = useMemo(() => classifyReviewItems(mine), [mine]);
  const targets = reviewSheetTargets(classified.items);
  const onMatchingSheet = targets.some((target) => pathname === `/m/${target.monthId}/s/${target.sheetId}`);
  const showBanner = Boolean(org.profile?.role === "rep" && classified.items.length > 0 && !onMatchingSheet);
  const autoKey = classified.autoResolve.map((item) => item.id).sort().join(",");

  useEffect(() => {
    if (classified.items.length > 0 || !autoKey) return;
    let cancelled = false;
    void resolveReview(classified.autoResolve).then((message) => {
      if (cancelled || message) return;
      retryCloudSync();
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [classified.items.length, autoKey, classified.autoResolve, resolveReview, router]);

  if (!showBanner) return null;

  return (
    <section className="summary-card review-banner no-print">
      <h2>Manager updates waiting on your worksheet</h2>
      <p className="empty-note">
        Open the pushed sheet to compare your live log with the manager version. Edit the bottom table, then confirm
        changes back to your manager.
      </p>
      <div className="cloud-setup-actions">
        {targets.map((target) => (
          <Button
            key={`${target.monthId}-${target.sheetId}`}
            nativeButton={false}
            render={<Link href={`/m/${target.monthId}/s/${target.sheetId}`} />}
          >
            Open {target.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
