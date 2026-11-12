import { ProposalScreen } from "@/features/proposals/proposal-screen";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProposalScreen proposalId={id} />;
}
