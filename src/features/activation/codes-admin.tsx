"use client";

import { Button } from "@/components/ui/button";
import { Badge, Card, EmptyState, InlineAlert, PageHeader } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/overlay";
import { activationEmail, describeAccess } from "@/lib/domain/activation";
import { formatDateBR, todayISO } from "@/lib/domain/dates";
import {
  generateActivationCode,
  listActivationCodes,
  revokeActivationCode,
  type ActivationCodeRow,
} from "@/lib/server/platform-actions";
import { useId, useState } from "react";

const ACCESS_OPTIONS = [
  { days: 30, label: "1 mês" },
  { days: 90, label: "3 meses" },
  { days: 180, label: "6 meses" },
  { days: 365, label: "1 ano" },
];

type Generated = { code: string; customerName: string; customerEmail: string; accessDays: number; validUntil: string };

function statusOf(c: ActivationCodeRow, today: string) {
  if (c.revokedAt) return { tone: "gray" as const, text: "Cancelado" };
  if (c.usedAt) return { tone: "green" as const, text: `Usado em ${formatDateBR(c.usedAt)}` };
  if (c.validUntil < today) return { tone: "red" as const, text: "Venceu sem uso" };
  return { tone: "blue" as const, text: `Disponível até ${formatDateBR(c.validUntil)}` };
}

export function CodesAdmin({ initialCodes, appUrl }: { initialCodes: ActivationCodeRow[]; appUrl: string }) {
  const [codes, setCodes] = useState(initialCodes);
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [revoking, setRevoking] = useState<ActivationCodeRow | null>(null);
  const today = todayISO();

  async function refresh() {
    const list = await listActivationCodes();
    if (list) setCodes(list);
  }

  return (
    <>
      <PageHeader
        title="Códigos de ativação"
        description="Depois que o cliente pagar, gere um código e envie por e-mail. Com ele, o cliente cria a empresa (ou renova o acesso)."
      />

      {generated ? (
        <GeneratedCard generated={generated} appUrl={appUrl} onDone={() => setGenerated(null)} />
      ) : (
        <GenerateForm
          onGenerated={async (g) => {
            setGenerated(g);
            await refresh();
          }}
        />
      )}

      <section aria-labelledby="lista" className="mt-8">
        <h2 id="lista" className="mb-3 font-display text-lg font-bold">
          Códigos gerados
        </h2>
        {codes.length === 0 ? (
          <EmptyState title="Nenhum código ainda">Os códigos que você gerar aparecem aqui.</EmptyState>
        ) : (
          <ul className="grid gap-2">
            {codes.map((c) => {
              const st = statusOf(c, today);
              return (
                <Card as="li" key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {c.customerName}
                      <span className="ml-2 font-mono text-sm text-muted">THIGU-••••-••••-{c.codeHint}</span>
                    </p>
                    <p className="text-sm text-muted">
                      {c.customerEmail ?? "Sem e-mail vinculado"} · {describeAccess(c.accessDays)} de acesso · gerado em{" "}
                      {formatDateBR(c.createdAt)}
                      {c.note ? ` · ${c.note}` : ""}
                    </p>
                    {c.companyName && (
                      <p className="text-sm">
                        Empresa: <strong>{c.companyName}</strong>
                        {c.companyAccessUntil ? ` · acesso até ${formatDateBR(c.companyAccessUntil)}` : ""}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={st.tone}>{st.text}</Badge>
                    {!c.usedAt && !c.revokedAt && (
                      <Button size="sm" variant="ghost" onClick={() => setRevoking(c)}>
                        Cancelar código
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </ul>
        )}
      </section>

      {revoking && (
        <RevokeDialog
          code={revoking}
          onClose={() => setRevoking(null)}
          onRevoked={async () => {
            setRevoking(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

function GenerateForm({ onGenerated }: { onGenerated: (g: Generated) => void }) {
  const [f, setF] = useState({
    customerName: "",
    customerEmail: "",
    access: "365",
    customDays: "",
    validDays: "30",
    note: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors(({ [k]: _drop, ...rest }) => rest);
    setGeneral(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const accessDays = f.access === "outro" ? Number(f.customDays) : Number(f.access);
    setPending(true);
    const r = await generateActivationCode({
      customerName: f.customerName,
      customerEmail: f.customerEmail,
      accessDays: Number.isFinite(accessDays) ? Math.trunc(accessDays) : 0,
      validDays: Number(f.validDays),
      note: f.note,
    });
    setPending(false);
    if (!r.ok || !r.code) {
      const fieldErrors = r.ok ? undefined : r.fieldErrors;
      setErrors(fieldErrors ?? {});
      if (!fieldErrors) setGeneral(r.message);
      return;
    }
    onGenerated({
      code: r.code,
      customerName: f.customerName.trim(),
      customerEmail: f.customerEmail.trim(),
      accessDays,
      validUntil: r.validUntil ?? todayISO(),
    });
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 font-display text-lg font-bold">Gerar código para um cliente</h2>
      <p className="mb-4 text-muted">Use depois de confirmar o pagamento.</p>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Nome do cliente"
            value={f.customerName}
            onChange={(e) => set("customerName")(e.target.value)}
            error={errors.customerName}
            data-autofocus
          />
          <TextField
            label="E-mail do comprador"
            type="email"
            value={f.customerEmail}
            onChange={(e) => set("customerEmail")(e.target.value)}
            error={errors.customerEmail}
            hint="Recomendado: o código só funciona para quem entrar com este e-mail. Deixe vazio para qualquer conta."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField label="Tempo de acesso" value={f.access} onChange={(e) => set("access")(e.target.value)}>
            {ACCESS_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>
                {o.label}
              </option>
            ))}
            <option value="outro">Outro (em dias)</option>
          </SelectField>
          {f.access === "outro" && (
            <TextField
              label="Quantos dias de acesso"
              inputMode="numeric"
              value={f.customDays}
              onChange={(e) => set("customDays")(e.target.value.replace(/\D/g, ""))}
              error={errors.accessDays}
            />
          )}
          <TextField
            label="Prazo para ativar (dias)"
            inputMode="numeric"
            value={f.validDays}
            onChange={(e) => set("validDays")(e.target.value.replace(/\D/g, ""))}
            error={errors.validDays}
            hint="Depois disso, o código deixa de funcionar."
          />
        </div>
        <TextAreaField
          label="Observação"
          optional
          value={f.note}
          onChange={(e) => set("note")(e.target.value)}
          hint="Só para a equipe. Ex.: nº do pedido ou forma de pagamento."
          className="min-h-16"
        />
        {general && <InlineAlert>{general}</InlineAlert>}
        <div>
          <Button type="submit" loading={pending}>
            Gerar código
          </Button>
        </div>
      </form>
    </Card>
  );
}

function GeneratedCard({ generated, appUrl, onDone }: { generated: Generated; appUrl: string; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const email = activationEmail({
    customerName: generated.customerName,
    code: generated.code,
    accessDays: generated.accessDays,
    validUntil: generated.validUntil,
    appUrl: appUrl || (typeof window !== "undefined" ? window.location.origin : ""),
  });
  const mailto = `mailto:${encodeURIComponent(generated.customerEmail)}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`;

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  return (
    <Card className="border-2 border-money p-5">
      <h2 className="font-display text-lg font-bold">Código gerado para {generated.customerName}</h2>
      <InlineAlert tone="amber" title="Este código só aparece agora">
        Por segurança, o sistema não guarda o código. Copie ou envie o e-mail antes de sair desta tela.
      </InlineAlert>
      <p className="my-4 select-all rounded-xl bg-canvas px-4 py-3 text-center font-mono text-2xl font-bold tracking-widest">
        {generated.code}
      </p>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => copy(generated.code, "codigo")}>Copiar código</Button>
        <Button variant="secondary" onClick={() => copy(`${email.subject}\n\n${email.body}`, "email")}>
          Copiar texto do e-mail
        </Button>
        {generated.customerEmail && (
          <a
            href={mailto}
            className="inline-flex min-h-11 items-center rounded-lg border border-line bg-white px-4 font-semibold hover:bg-canvas"
          >
            Abrir no meu e-mail
          </a>
        )}
      </div>
      <p role="status" className="mb-3 min-h-6 text-sm font-semibold text-money-700">
        {copied === "codigo" ? "Código copiado." : copied === "email" ? "Texto do e-mail copiado." : ""}
      </p>
      <details className="rounded-lg border border-line bg-white p-3">
        <summary className="cursor-pointer font-semibold">Ver o texto do e-mail</summary>
        <p className="mt-2 text-sm text-muted">Assunto: {email.subject}</p>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{email.body}</pre>
      </details>
      <Button className="mt-4" variant="ghost" onClick={onDone}>
        Gerar outro código
      </Button>
    </Card>
  );
}

function RevokeDialog({
  code,
  onClose,
  onRevoked,
}: {
  code: ActivationCodeRow;
  onClose: () => void;
  onRevoked: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const titleId = useId();
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Cancelar este código?"
      description={
        <span id={titleId}>
          {code.customerName} · THIGU-••••-••••-{code.codeHint}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Manter código
          </Button>
          <Button
            variant="danger"
            loading={pending}
            onClick={async () => {
              setPending(true);
              const r = await revokeActivationCode(code.id);
              setPending(false);
              if (!r.ok) return setError(r.message);
              onRevoked();
            }}
          >
            Cancelar código
          </Button>
        </>
      }
    >
      <p>
        Depois de cancelado, o código não ativa mais nenhuma empresa. Use se ele foi enviado por engano ou houve
        estorno.
      </p>
      {error && (
        <div className="mt-3">
          <InlineAlert>{error}</InlineAlert>
        </div>
      )}
    </Modal>
  );
}
