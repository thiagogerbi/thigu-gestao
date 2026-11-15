"use client";

import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/card";
import { Modal } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { ActivationCodeField } from "@/features/activation/activation-code-field";
import { codeFormatError } from "@/lib/domain/activation";
import { diffDays, formatDateBR } from "@/lib/domain/dates";
import { can } from "@/lib/domain/permissions";
import { renewAccess } from "@/lib/server/actions";
import { useBackend } from "@/state/backend-context";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

/** A partir de quantos dias antes do vencimento o aviso aparece. */
export const WARN_DAYS = 14;

export type AccessState =
  { kind: "sem-prazo" } | { kind: "ok" | "vencendo" | "vencido"; until: string; daysLeft: number };

export function accessState(accessUntil: string | null, today: string): AccessState {
  if (!accessUntil) return { kind: "sem-prazo" };
  const daysLeft = diffDays(today, accessUntil);
  if (daysLeft < 0) return { kind: "vencido", until: accessUntil, daysLeft };
  if (daysLeft <= WARN_DAYS) return { kind: "vencendo", until: accessUntil, daysLeft };
  return { kind: "ok", until: accessUntil, daysLeft };
}

/** Faixa no topo: aparece só perto do vencimento ou depois dele. */
export function AccessBanner() {
  const { data, today, me, mode } = useBackend();
  const [open, setOpen] = useState(false);
  if (mode !== "real") return null;
  const st = accessState(data.company.accessUntil, today);
  if (st.kind === "sem-prazo" || st.kind === "ok") return null;
  const isAdmin = can(me.roles, "empresa.gerenciar");
  const expired = st.kind === "vencido";

  return (
    <div
      role={expired ? "alert" : "status"}
      className={cx(
        "border-b px-4 py-3 lg:px-8 print:hidden",
        expired ? "border-[#f7c9c4] bg-danger-50 text-danger" : "border-[#f5d9a8] bg-warn-50 text-[#6b4106]",
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex-1 basis-72">
          {expired ? (
            <>
              <strong>O acesso da empresa venceu em {formatDateBR(st.until)}.</strong> Você ainda pode consultar tudo,
              mas não dá para registrar nada novo até renovar.
            </>
          ) : (
            <>
              <strong>
                O acesso da empresa vai até {formatDateBR(st.until)}
                {st.daysLeft === 0
                  ? " (vence hoje)"
                  : st.daysLeft === 1
                    ? " (falta 1 dia)"
                    : ` (faltam ${st.daysLeft} dias)`}
                .
              </strong>{" "}
              Renove para continuar sem interrupção.
            </>
          )}
          {!isAdmin && " Avise o administrador da empresa."}
        </p>
        {isAdmin && (
          <Button size="sm" variant={expired ? "danger" : "primary"} onClick={() => setOpen(true)}>
            Renovar com código
          </Button>
        )}
      </div>
      {open && <RenewDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Cartão em "Minha empresa" com a situação do acesso. */
export function AccessCard() {
  const { data, today, me, mode } = useBackend();
  const [open, setOpen] = useState(false);
  if (mode !== "real") return null;
  const st = accessState(data.company.accessUntil, today);
  if (st.kind === "sem-prazo") return null;
  const isAdmin = can(me.roles, "empresa.gerenciar");
  return (
    <section aria-labelledby="acesso" className="mb-6 rounded-xl border border-line bg-white p-4">
      <h2 id="acesso" className="font-display text-lg font-bold">
        Acesso ao Thigu
      </h2>
      <p className={cx("mt-1", st.kind === "vencido" ? "font-semibold text-danger" : "text-ink")}>
        {st.kind === "vencido"
          ? `Venceu em ${formatDateBR(st.until)}. A empresa está somente para consulta.`
          : `Válido até ${formatDateBR(st.until)}.`}
      </p>
      <p className="text-sm text-muted">
        Para renovar, compre mais um período e digite aqui o novo código que chegar por e-mail. Os dias são somados ao
        prazo atual.
      </p>
      {isAdmin && (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Renovar com código
        </Button>
      )}
      {open && <RenewDialog onClose={() => setOpen(false)} />}
    </section>
  );
}

function RenewDialog({ onClose }: { onClose: () => void }) {
  const { data } = useBackend();
  const router = useRouter();
  const toast = useToast();
  const formId = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const local = codeFormatError(code);
    if (local) return setError(local);
    setPending(true);
    const r = await renewAccess(data.company.id, code);
    setPending(false);
    if (!r.ok) return setError(r.fieldErrors?.code ?? r.message);
    toast({ tone: "success", text: r.message });
    onClose();
    router.refresh();
  }

  return (
    <Modal
      open
      onClose={onClose}
      dirty={code !== ""}
      size="sm"
      title="Renovar acesso"
      description="Digite o código de ativação que chegou por e-mail depois da compra."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            Renovar acesso
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid gap-3" noValidate>
        <ActivationCodeField
          value={code}
          onChange={(v) => {
            setCode(v);
            setError(null);
          }}
          error={error}
          autoFocus
        />
        <InlineAlert tone="blue">Os dias do novo código são somados ao que ainda resta do prazo atual.</InlineAlert>
      </form>
    </Modal>
  );
}
