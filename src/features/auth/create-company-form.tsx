"use client";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { TextField } from "@/components/ui/fields";
import { ActivationCodeField } from "@/features/activation/activation-code-field";
import { codeFormatError } from "@/lib/domain/activation";
import { createCompany } from "@/lib/server/actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Cadastro da empresa: só acontece com um código de ativação recebido depois da compra. */
export function CreateCompanyForm({ salesContact }: { salesContact?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local: Record<string, string> = {};
    if (name.trim().length < 2) local.name = "Digite o nome da empresa (pelo menos 2 letras).";
    const codeErr = codeFormatError(code);
    if (codeErr) local.code = codeErr;
    setErrors(local);
    setGeneral(null);
    if (Object.keys(local).length) return;

    setPending(true);
    const r = await createCompany(name, code);
    setPending(false);
    if (!r.ok) {
      setErrors(r.fieldErrors ?? {});
      if (!r.fieldErrors) setGeneral(r.message);
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <TextField
        label="Nome da empresa"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setErrors(({ name: _n, ...rest }) => rest);
        }}
        error={errors.name}
        hint="Como seus clientes conhecem o seu negócio. Dá para mudar depois."
        data-autofocus
      />
      <ActivationCodeField
        value={code}
        onChange={(v) => {
          setCode(v);
          setErrors(({ code: _c, ...rest }) => rest);
        }}
        error={errors.code}
      />
      {general && <InlineAlert>{general}</InlineAlert>}
      <Button type="submit" size="lg" loading={pending}>
        Ativar e criar empresa
      </Button>
      <p className="text-sm text-muted">
        Ainda não tem um código? Ele é enviado por e-mail depois da compra do Thigu Gestão.
        {salesContact ? (
          <>
            {" "}
            Para comprar ou tirar dúvidas:{" "}
            <a className="font-semibold text-primary-700 underline" href={salesContact}>
              fale com a gente
            </a>
            .
          </>
        ) : null}
      </p>
    </form>
  );
}
