"use client";

import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/server/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Sair para entrar com outra conta (útil quando o código foi enviado para outro e-mail). */
export function SignOutButton({ label = "Sair e entrar com outro e-mail" }: { label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="mt-2 -ml-3"
      loading={pending}
      onClick={async () => {
        setPending(true);
        await signOut();
        router.push("/entrar");
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
