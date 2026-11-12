"use client";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { createCompany } from "@/lib/server/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateCompanyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const r = await createCompany(name);
    setPending(false);
    if (!r.ok) return setError(r.fieldErrors?.name ?? r.message);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <TextField
        label="Nome da empresa"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setError(null);
        }}
        error={error}
        data-autofocus
      />
      <Button type="submit" loading={pending}>
        Criar empresa
      </Button>
    </form>
  );
}
