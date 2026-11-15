import { WorkOrderScreen } from "@/features/workshop/work-order-screen";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkOrderScreen workOrderId={id} />;
}
