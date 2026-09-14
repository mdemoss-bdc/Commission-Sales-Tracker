import { MonthPage } from "@/components/month-page";

export default async function Page({ params }: PageProps<"/m/[monthId]">) {
  const { monthId } = await params;
  return (
    <main className="page-shell">
      <MonthPage monthId={monthId} />
    </main>
  );
}
