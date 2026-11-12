import { CompanyScreen } from "@/features/company/company-screen";
import { MembersManager } from "@/features/company/members-manager";

export default function Page() {
  return <CompanyScreen manager={<MembersManager />} />;
}
