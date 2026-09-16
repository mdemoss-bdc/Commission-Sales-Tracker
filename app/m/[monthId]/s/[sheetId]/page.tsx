import { Suspense } from "react";
import { PayTracker } from "@/components/pay-tracker";

export default async function Page({
  params,
}: PageProps<"/m/[monthId]/s/[sheetId]">) {
  const { monthId, sheetId } = await params;
  return (
    <main className="page-shell">
      <Suspense fallback={<p className="empty-note">Loading sheet…</p>}>
        <PayTracker monthId={monthId} sheetId={sheetId} />
      </Suspense>
    </main>
  );
}
