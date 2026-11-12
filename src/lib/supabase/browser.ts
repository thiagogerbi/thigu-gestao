"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Usado apenas na tela de login/cadastro. URL e chave pública chegam como props do servidor. */
export function createSupabaseBrowserClient(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}
