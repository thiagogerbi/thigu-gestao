"use client";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { cx } from "@/components/ui/styles";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ url, anonKey }: { url: string; anonKey: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"entrar" | "criar">("entrar");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (mode === "criar" && name.trim().length < 2) return setError("Digite seu nome.");
    if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
    setPending(true);
    const sb = createSupabaseBrowserClient(url, anonKey);
    try {
      if (mode === "entrar") {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) return setError("E-mail ou senha incorretos. Confira e tente de novo.");
        router.push("/app");
        router.refresh();
      } else {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (error)
          return setError(
            error.message.includes("registered")
              ? "Já existe uma conta com este e-mail. Use “Entrar”."
              : "Não foi possível criar a conta. Verifique os dados.",
          );
        if (!data.session)
          return setInfo("Conta criada. Enviamos um e-mail de confirmação: clique no link e depois entre aqui.");
        router.push("/app");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <div
        role="tablist"
        aria-label="Escolha"
        className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-canvas p-1"
      >
        {(["entrar", "criar"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={cx("min-h-10 rounded-lg font-semibold", mode === m ? "bg-white shadow-sm" : "text-muted")}
          >
            {m === "entrar" ? "Entrar" : "Criar conta"}
          </button>
        ))}
      </div>
      {mode === "criar" && (
        <TextField label="Seu nome" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      )}
      <TextField
        label="E-mail"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
      />
      <TextField
        label="Senha"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete={mode === "entrar" ? "current-password" : "new-password"}
        hint={mode === "criar" ? "Pelo menos 8 caracteres." : undefined}
      />
      {error && <InlineAlert>{error}</InlineAlert>}
      {info && <InlineAlert tone="green">{info}</InlineAlert>}
      <Button type="submit" size="lg" loading={pending}>
        {mode === "entrar" ? "Entrar" : "Criar minha conta"}
      </Button>
    </form>
  );
}
