"use client";
import { Button } from "@/components/ui/button";
import { Card, InlineAlert } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";
import { BrandColorPicker } from "@/features/company/brand-color-picker";
import { CompanyLetterhead } from "@/features/company/company-letterhead";
import { prepareLogo } from "@/features/company/logo-image";
import { brandPalette, THIGU_BLUE } from "@/lib/domain/branding";
import { formatDocument } from "@/lib/domain/document";
import type { CompanyProfile } from "@/lib/domain/types";
import { useAction, useBackend } from "@/state/backend-context";
import { useId, useRef, useState } from "react";

type Draft = Omit<CompanyProfile, "id">;

function toDraft(c: CompanyProfile): Draft {
  const { id: _id, ...rest } = c;
  return { ...rest, document: c.document ? formatDocument(c.document) : "" };
}

/** Dados da empresa e identidade visual. Só o administrador vê este formulário. */
export function CompanyProfileForm() {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending, error, fieldErrors, clearField } = useAction();
  const [saved, setSaved] = useState(() => toDraft(data.company));
  const [draft, setDraft] = useState(saved);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logoId = useId();

  // quando outra empresa é escolhida no seletor, o formulário recomeça com os dados dela
  const [companyId, setCompanyId] = useState(data.company.id);
  if (companyId !== data.company.id) {
    setCompanyId(data.company.id);
    const next = toDraft(data.company);
    setSaved(next);
    setDraft(next);
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    clearField(key);
  };

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    setLogoBusy(true);
    try {
      set("logoDataUrl", await prepareLogo(file));
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "Não foi possível usar esta imagem.");
    } finally {
      setLogoBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const r = await exec({ type: "company.saveProfile", ...draft });
    if (r.ok) {
      setSaved(draft);
      toast({ tone: "success", text: r.message });
    }
  }

  const palette = brandPalette(draft.brandColor ?? THIGU_BLUE);
  const previewStyle = {
    "--color-primary": palette.primary,
    "--color-primary-700": palette.primary700,
    "--color-primary-50": palette.primary50,
  } as React.CSSProperties;

  return (
    <Card className="mb-6 p-4 sm:p-6">
      <form onSubmit={submit} noValidate>
        <h2 className="font-display text-lg font-bold">Dados e aparência da empresa</h2>
        <p className="mb-5 text-muted">
          Estes dados aparecem no topo das propostas que você envia. A cor vale para todas as pessoas da empresa.
        </p>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div className="grid content-start gap-4">
            <TextField
              label="Nome da empresa"
              hint="Como seus clientes conhecem a empresa."
              value={draft.name}
              onChange={(e) => set("name", e.target.value)}
              error={fieldErrors.name}
              maxLength={120}
            />
            <TextField
              label="Razão social"
              optional
              value={draft.legalName}
              onChange={(e) => set("legalName", e.target.value)}
              error={fieldErrors.legalName}
              maxLength={160}
            />
            <TextField
              label="CNPJ ou CPF"
              optional
              hint="Pode digitar com ou sem pontos. Aceita o CNPJ novo, com letras."
              value={draft.document}
              onChange={(e) => set("document", e.target.value.toUpperCase())}
              onBlur={() => set("document", draft.document ? formatDocument(draft.document) : "")}
              error={fieldErrors.document}
              maxLength={30}
              autoComplete="off"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Telefone"
                optional
                type="tel"
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
                error={fieldErrors.phone}
                maxLength={30}
              />
              <TextField
                label="E-mail de contato"
                optional
                type="email"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
                error={fieldErrors.email}
                maxLength={200}
              />
            </div>
            <TextField
              label="Endereço"
              optional
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
              error={fieldErrors.address}
              maxLength={300}
            />
            <TextAreaField
              label="Condições comerciais padrão"
              optional
              hint="Já vem preenchido em cada proposta nova. Dá para mudar em cada uma."
              value={draft.defaultTerms}
              onChange={(e) => set("defaultTerms", e.target.value)}
              error={fieldErrors.defaultTerms}
              maxLength={2000}
            />
          </div>

          <div className="grid content-start gap-5">
            <div>
              <p className="mb-1 text-sm font-semibold text-ink" id={`${logoId}-label`}>
                Logotipo <span className="font-normal text-muted">(opcional)</span>
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-20 w-40 items-center justify-center rounded-lg border border-dashed border-[#c5cfdf] bg-canvas p-2">
                  {draft.logoDataUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.logoDataUrl}
                      alt="Logotipo escolhido"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-sm text-muted">Sem logotipo</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <input
                    ref={fileRef}
                    id={logoId}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="sr-only"
                    aria-labelledby={`${logoId}-label`}
                    onChange={(e) => pickLogo(e.target.files?.[0])}
                  />
                  <Button variant="secondary" size="sm" loading={logoBusy} onClick={() => fileRef.current?.click()}>
                    {draft.logoDataUrl ? "Trocar imagem" : "Escolher imagem"}
                  </Button>
                  {draft.logoDataUrl && (
                    <Button variant="ghost" size="sm" onClick={() => set("logoDataUrl", null)}>
                      Remover logotipo
                    </Button>
                  )}
                </div>
              </div>
              <p className="mt-1 text-sm text-muted">PNG, JPG, WebP ou SVG. Reduzimos o tamanho automaticamente.</p>
              {(logoError || fieldErrors.logoDataUrl) && (
                <p className="mt-1 text-sm font-medium text-danger" role="alert">
                  {logoError ?? fieldErrors.logoDataUrl}
                </p>
              )}
            </div>

            <BrandColorPicker value={draft.brandColor} onChange={(hex) => set("brandColor", hex)} />

            <div style={previewStyle} aria-label="Prévia" role="group">
              <p className="mb-1 text-sm font-semibold text-ink">Prévia</p>
              <div className="rounded-lg border border-line bg-white p-4">
                <CompanyLetterhead
                  company={{
                    ...draft,
                    id: data.company.id,
                    name: draft.name || "Nome da empresa",
                  }}
                />
                <div className="mt-4 flex flex-wrap gap-2" aria-hidden="true">
                  <span className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-sm font-semibold text-white">
                    Botão principal
                  </span>
                  <span className="inline-flex min-h-9 items-center rounded-lg bg-primary-50 px-3 text-sm font-semibold text-primary-700">
                    Destaque
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {error && Object.keys(fieldErrors).length === 0 && (
          <div className="mt-4">
            <InlineAlert>{error}</InlineAlert>
          </div>
        )}
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <Button type="submit" loading={pending} disabled={!dirty}>
            Salvar dados da empresa
          </Button>
          {dirty ? (
            <>
              <Button variant="ghost" onClick={() => setDraft(saved)} disabled={pending}>
                Desfazer alterações
              </Button>
              <span className="text-sm text-muted">Há alterações ainda não salvas.</span>
            </>
          ) : (
            <span className="text-sm text-muted">Tudo salvo.</span>
          )}
        </div>
      </form>
    </Card>
  );
}
