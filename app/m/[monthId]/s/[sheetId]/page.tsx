import { PayTracker } from "@/components/pay-tracker";

export default async function Page({
  params,
}: PageProps<"/m/[monthId]/s/[sheetId]">) {
  const { monthId, sheetId } = await params;
  return (
    <main className="page-shell">
      <PayTracker monthId={monthId} sheetId={sheetId} />
    </main>
  );
}
