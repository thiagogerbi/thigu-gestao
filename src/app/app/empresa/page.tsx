import { CompanyScreen } from "@/features/company/company-screen";
import { MembersManager } from "@/features/company/members-manager";
import type { CompanyInvite } from "@/lib/domain/types";
import { COMPANY_COOKIE } from "@/lib/server/constants";
import { loadCompanyInvites, loadMemberships } from "@/lib/server/load";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

/** Convites em aberto da empresa atual; só o administrador os vê (o banco não devolve para os demais). */
async function pendingInvites(): Promise<CompanyInvite[]> {
  const sb = await createSupabaseServerClient();
  if (!sb) return [];
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return [];
  const memberships = await loadMemberships(sb, auth.user.id);
  const chosen = (await cookies()).get(COMPANY_COOKIE)?.value;
  const current = memberships.find((m) => m.companyId === chosen) ?? memberships[0];
  if (!current?.roles.includes("admin")) return [];
  return loadCompanyInvites(sb, current.companyId);
}

export default async function Page() {
  return <CompanyScreen manager={<MembersManager invites={await pendingInvites()} />} />;
}
