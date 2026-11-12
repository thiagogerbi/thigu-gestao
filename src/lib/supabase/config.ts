/**
 * Somente a URL e a chave pública (anon) são usadas. A chave service_role nunca é lida pelo app:
 * toda operação roda com a sessão do usuário, e o banco aplica RLS e as funções com verificação de papel.
 */
export function supabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}
