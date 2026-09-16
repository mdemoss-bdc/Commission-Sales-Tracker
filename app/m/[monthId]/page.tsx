import { Suspense } from "react";
import { MonthPage } from "@/components/month-page";

export default async function Page({ params }: PageProps<"/m/[monthId]">) {
  const { monthId } = await params;
  return (
    <main className="page-shell">
      <Suspense fallback={<p className="empty-note">Loading month…</p>}>
        <MonthPage monthId={monthId} />
      </Suspense>
    </main>
  );
}
