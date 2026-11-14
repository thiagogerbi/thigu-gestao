"use client";
import { useDialogs } from "@/components/layout/dialog-context";
import { Button, IconButton, LinkButton } from "@/components/ui/button";
import { Badge, Card, EmptyState, InlineAlert, PageHeader } from "@/components/ui/card";
import { MoneyField, TextAreaField, TextField } from "@/components/ui/fields";
import { IconAlert, IconArrowLeft, IconPlus, IconX } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { useToast } from "@/components/ui/toast";
import { PlateBadge } from "@/features/workshop/plate-badge";
import { prepareWorkOrderPhoto } from "@/features/workshop/photo-image";
import { stageTone } from "@/features/workshop/yard-screen";
import { localParts } from "@/lib/domain/agenda";
import { formatDateBR, formatShortDateBR } from "@/lib/domain/dates";
import { centsToInput, formatBRL, parseBRLToCents } from "@/lib/domain/money";
import { can } from "@/lib/domain/permissions";
import { whatsappUrl } from "@/lib/domain/phone";
import type { WorkOrder, WorkOrderItem } from "@/lib/domain/types";
import {
  FUEL_LABEL,
  isLate,
  isOpenStage,
  lineTotal,
  PHOTO_LIMIT,
  quoteMessage,
  readyMessage,
  warrantyUntil,
  WO_STAGE_LABEL,
  YARD_STAGES,
} from "@/lib/domain/work-orders";
import { useAction, useBackend, useMemberName } from "@/state/backend-context";
import { useNav } from "@/state/use-nav";
import { useWorkshop } from "@/state/use-workshop";
import { useRef, useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};
const CHANNEL = { link: "pelo link", presencial: "na oficina", telefone: "por telefone", whatsapp: "pelo WhatsApp" };
const ITEM_STATUS = {
  pendente: { label: "Aguardando cliente", tone: "amber" },
  aprovado: { label: "Aprovado", tone: "green" },
  recusado: { label: "Recusado", tone: "gray" },
} as const;

/** Ficha da ordem de serviço: entrada, diagnóstico, orçamento, aprovação, fotos, etapas e entrega. */
export function WorkOrderScreen({ workOrderId }: { workOrderId: string }) {
  const { data, me, today } = useBackend();
  const ws = useWorkshop();
  const nav = useNav();
  const dialogs = useDialogs();
  const toast = useToast();
  const name = useMemberName();
  const { exec, pending } = useAction();
  const origin = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => "",
  );
  const w = data.workOrders.find((x) => x.id === workOrderId);

  if (!ws.enabled || !w) {
    return (
      <>
        <PageHeader title="Ordem de serviço" />
        <EmptyState
          title="OS não encontrada"
          action={<LinkButton href={nav.href("/oficina")}>Voltar para o pátio</LinkButton>}
        >
          Ela pode ter sido aberta em outra empresa, ou não está ligada a você.
        </EmptyState>
      </>
    );
  }

  const client = ws.client(w);
  const items = ws.itemsFor(w);
  const t = ws.totalsFor(w);
  const open = isOpenStage(w.stage);
  const work = open && ws.canWork(w);
  const edit = open && ws.canEdit;
  const pendingItems = items.filter((i) => i.status === "pendente");
  const photos = data.workOrderPhotos.filter((p) => p.workOrderId === w.id);
  const events = data.workOrderEvents
    .filter((e) => e.workOrderId === w.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const link = ws.quoteLink(w, origin);
  const vehicleText = { model: ws.vehicleName(w), plate: ws.vehicle(w)?.plate };
  const quoteWa =
    client &&
    link &&
    whatsappUrl(
      client.phone,
      quoteMessage({ clientName: client.name, companyName: data.company.name, link, ...vehicleText }),
    );
  const readyWa =
    client &&
    whatsappUrl(
      client.phone,
      readyMessage({ clientName: client.name, companyName: data.company.name, ...vehicleText }),
    );
  const stages = YARD_STAGES.filter((s) => s === w.stage || ws.canMoveTo(w, s));

  async function run(action: Parameters<typeof exec>[0], quiet = false) {
    const r = await exec(action);
    if (!quiet || !r.ok) toast({ tone: r.ok ? "success" : "error", text: r.message });
    return r;
  }

  return (
    <>
      <div className="mb-2">
        <LinkButton href={nav.href("/oficina")} variant="ghost" size="sm" className="-ml-3">
          <IconArrowLeft className="h-4 w-4" /> Pátio
        </LinkButton>
      </div>
      <PageHeader
        title={`OS nº ${w.number}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PlateBadge plate={ws.plate(w)} />
            <span className="font-semibold text-ink">{ws.vehicleName(w)}</span>
            {client && (
              <button
                type="button"
                className="underline-offset-2 hover:underline"
                onClick={() => nav.openClient(client.id)}
              >
                {client.name}
              </button>
            )}
            <span>· {ws.mechanicName(w)}</span>
          </span>
        }
        actions={
          <>
            {w.stage === "pronto" && readyWa && (
              <a
                href={readyWa}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#bfe8d8] bg-money-50 px-4 text-[15px] font-semibold text-money-700"
              >
                Avisar que está pronto
              </a>
            )}
            {open && ws.canDeliver && (
              <Button variant="money" onClick={() => dialogs.open({ kind: "woDeliver", workOrderId: w.id })}>
                Entregar e cobrar
              </Button>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={stageTone(w.stage)}>{WO_STAGE_LABEL[w.stage]}</Badge>
        {isLate(w, today) && <Badge tone="red">Atrasada: prometida para {formatShortDateBR(w.promisedOn!)}</Badge>}
        {open && stages.length > 1 && (
          <label className="ml-auto flex items-center gap-2 text-sm font-semibold">
            Mudar etapa
            <select
              value={w.stage}
              disabled={pending}
              onChange={(e) =>
                run({ type: "workOrder.move", id: w.id, stage: e.target.value as (typeof YARD_STAGES)[number] })
              }
              className="min-h-10 rounded-lg border border-[#c5cfdf] bg-white px-2 font-normal"
            >
              {stages.map((s) => (
                <option key={s} value={s}>
                  {WO_STAGE_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {w.stage === "cancelada" && (
        <div className="mb-5">
          <InlineAlert title="OS cancelada">{w.cancelReason}</InlineAlert>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid min-w-0 content-start gap-6">
          <QuoteCard w={w} items={items} totals={t} work={work} edit={edit} />

          {pendingItems.length > 0 && edit && (
            <Card className="border-warn/40 p-4" aria-labelledby="aprovacao">
              <h2 id="aprovacao" className="font-display text-lg font-bold">
                {pendingItems.length === 1
                  ? "1 item aguarda o cliente"
                  : `${pendingItems.length} itens aguardam o cliente`}
              </h2>
              <p className="mb-3 text-sm text-muted">
                Mande o link para o cliente aprovar pelo celular (ele escolhe o que quer fazer), ou registre a aprovação
                feita na oficina ou por telefone.
              </p>
              {w.sentAt && link ? (
                <div className="mb-3 rounded-lg bg-canvas p-3 text-sm">
                  <p className="font-semibold">Link do orçamento</p>
                  <p className="mt-1 break-all font-mono">{link}</p>
                  <p className="mt-1 text-muted">
                    Enviado em {formatDateBR(w.sentAt)} às {localParts(w.sentAt).time}.
                  </p>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!w.sentAt ? (
                  <Button disabled={pending} onClick={() => run({ type: "workOrder.send", id: w.id })}>
                    Gerar link do orçamento
                  </Button>
                ) : (
                  <>
                    {quoteWa ? (
                      <a
                        href={quoteWa}
                        target="_blank"
                        rel="noopener"
                        className="inline-flex min-h-11 items-center rounded-lg bg-money-700 px-4 text-[15px] font-semibold text-white"
                      >
                        Enviar pelo WhatsApp
                      </a>
                    ) : (
                      <span className="text-sm text-muted">O cliente não tem celular com DDD para o WhatsApp.</span>
                    )}
                    {link && (
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(link);
                            toast({ tone: "success", text: "Link copiado." });
                          } catch {
                            toast({ tone: "error", text: "Não deu para copiar. Selecione o link e copie." });
                          }
                        }}
                      >
                        Copiar link
                      </Button>
                    )}
                  </>
                )}
                <Button variant="secondary" onClick={() => dialogs.open({ kind: "woApprove", workOrderId: w.id })}>
                  Registrar aprovação
                </Button>
              </div>
            </Card>
          )}

          <DiagnosisCard w={w} work={work} />
          <PhotosCard w={w} work={work} count={photos.length} />
        </div>

        <div className="grid content-start gap-6">
          <Card className="p-4" aria-labelledby="entrada">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 id="entrada" className="font-display text-lg font-bold">
                Entrada
              </h2>
              {edit && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => dialogs.open({ kind: "workOrderEdit", workOrderId: w.id })}
                >
                  Editar
                </Button>
              )}
            </div>
            <dl className="grid gap-2 text-sm">
              <div>
                <dt className="font-semibold">O que o cliente relatou</dt>
                <dd className="whitespace-pre-line text-muted">{w.complaint || "—"}</dd>
              </div>
              <div className="flex gap-6">
                <div>
                  <dt className="font-semibold">Km</dt>
                  <dd className="tabular text-muted">{w.km !== null ? w.km.toLocaleString("pt-BR") : "—"}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Combustível</dt>
                  <dd className="text-muted">{w.fuel ? FUEL_LABEL[w.fuel] : "—"}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Previsão</dt>
                  <dd className="text-muted">{w.promisedOn ? formatShortDateBR(w.promisedOn) : "—"}</dd>
                </div>
              </div>
              <div>
                <dt className="font-semibold">Conferido na entrada</dt>
                <dd className="text-muted">{w.checklist.length ? w.checklist.join(", ") : "—"}</dd>
              </div>
              <div>
                <dt className="font-semibold">Aberta</dt>
                <dd className="text-muted">
                  {formatDateBR(w.createdAt)} por {name(w.createdBy)}
                </dd>
              </div>
            </dl>
          </Card>

          {w.approvedAt && (
            <Card className="p-4" aria-labelledby="aprovado">
              <h2 id="aprovado" className="font-display text-lg font-bold">
                Aprovação
              </h2>
              <p className="text-sm">
                Decidido por <span className="font-semibold">{w.approvedByName}</span>{" "}
                {w.approvalChannel && CHANNEL[w.approvalChannel]} em {formatDateBR(w.approvedAt)} às{" "}
                {localParts(w.approvedAt).time}.
              </p>
              <p className="mt-1 text-sm text-muted">
                Aprovado {formatBRL(t.approved)}
                {t.refused > 0 && ` · recusado ${formatBRL(t.refused)}`}
              </p>
            </Card>
          )}

          {w.stage === "entregue" && <DeliveredCard w={w} items={items} />}

          <Card className="p-4" aria-labelledby="historico-os">
            <h2 id="historico-os" className="mb-2 font-display text-lg font-bold">
              Linha do tempo
            </h2>
            <ol className="grid gap-2 text-sm">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3">
                  <p>{e.description}</p>
                  <p className="text-muted">
                    {formatShortDateBR(localParts(e.createdAt).date)} {localParts(e.createdAt).time}
                    {e.actorId ? ` · ${name(e.actorId)}` : " · cliente"}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          {edit && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => dialogs.open({ kind: "woCancel", workOrderId: w.id })}
            >
              Cancelar esta OS
            </Button>
          )}
          {!ws.canEdit && ws.isMine(w) && open && (
            <p className="text-sm text-muted">
              Você é o mecânico desta OS: inclua peças e serviços (o cliente aprova antes), fotos e o diagnóstico, e
              mude entre aguardando peça, em serviço e pronto.
            </p>
          )}
          {can(me.roles, "financeiro.ver") && w.stage === "entregue" && (
            <LinkButton href={nav.href("/financeiro")} variant="secondary">
              Ver no financeiro
            </LinkButton>
          )}
        </div>
      </div>
    </>
  );
}

function QuoteCard({
  w,
  items,
  totals: t,
  work,
  edit,
}: {
  w: WorkOrder;
  items: WorkOrderItem[];
  totals: ReturnType<ReturnType<typeof useWorkshop>["totalsFor"]>;
  work: boolean;
  edit: boolean;
}) {
  const { me } = useBackend();
  const dialogs = useDialogs();
  const toast = useToast();
  const { exec, pending, fieldErrors, clear } = useAction();
  const [discount, setDiscount] = useState<string | null>(null);
  const groups = [
    { kind: "peca" as const, title: "Peças", list: items.filter((i) => i.kind === "peca") },
    { kind: "servico" as const, title: "Mão de obra", list: items.filter((i) => i.kind === "servico") },
  ];

  async function saveDiscount() {
    const cents = discount === null || discount.trim() === "" ? 0 : parseBRLToCents(discount);
    if (cents === null || cents < 0) return toast({ tone: "error", text: "Digite o desconto, por exemplo 50,00." });
    const r = await exec({ type: "workOrder.discount", id: w.id, discountCents: cents });
    toast({ tone: r.ok ? "success" : "error", text: r.message });
    if (r.ok) setDiscount(null);
  }

  return (
    <Card className="p-4" aria-labelledby="orcamento">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="orcamento" className="font-display text-lg font-bold">
          Orçamento
        </h2>
        {work && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => dialogs.open({ kind: "woItem", workOrderId: w.id, itemKind: "peca" })}
            >
              <IconPlus className="h-4 w-4" /> Peça
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => dialogs.open({ kind: "woItem", workOrderId: w.id, itemKind: "servico" })}
            >
              <IconPlus className="h-4 w-4" /> Mão de obra
            </Button>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">
          {work ? "Inclua as peças e a mão de obra. O cliente aprova antes de o serviço começar." : "Ainda sem itens."}
        </p>
      ) : (
        groups
          .filter((g) => g.list.length)
          .map((g) => (
            <div key={g.kind} className="mb-3">
              <h3 className="mb-1 text-sm font-semibold text-muted">{g.title}</h3>
              <ul className="divide-y divide-line">
                {g.list.map((i) => (
                  <li
                    key={i.id}
                    className={cx(
                      "flex items-start justify-between gap-2 py-2",
                      i.status === "recusado" && "opacity-60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className={cx("font-medium", i.status === "recusado" && "line-through")}>
                        {i.quantity > 1 && <span className="tabular">{i.quantity} × </span>}
                        {i.description}
                      </p>
                      <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
                        <Badge tone={ITEM_STATUS[i.status].tone} className="text-xs">
                          {ITEM_STATUS[i.status].label}
                        </Badge>
                        {i.quantity > 1 && <span className="tabular">{formatBRL(i.unitCents)} cada</span>}
                        {i.warrantyDays && <span>garantia {i.warrantyDays} dias</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="font-semibold tabular">{formatBRL(lineTotal(i))}</span>
                      {work && i.status === "pendente" && (
                        <IconButton
                          label={`Tirar ${i.description}`}
                          className="h-9 w-9"
                          disabled={pending}
                          onClick={async () => {
                            const r = await exec({ type: "workOrder.removeItem", id: i.id });
                            if (!r.ok) toast({ tone: "error", text: r.message });
                          }}
                        >
                          <IconX className="h-4 w-4" />
                        </IconButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
      )}
      {items.length > 0 && (
        <dl className="mt-2 grid gap-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between">
            <dt>Peças</dt>
            <dd className="tabular">{formatBRL(t.parts)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Mão de obra</dt>
            <dd className="tabular">{formatBRL(t.labor)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>Desconto</dt>
            <dd className="tabular">
              {edit && discount !== null ? (
                <span className="flex items-end gap-1">
                  <MoneyField
                    label={<span className="sr-only">Desconto</span>}
                    value={discount}
                    onChange={(e) => {
                      setDiscount(e.target.value);
                      clear();
                    }}
                    error={fieldErrors.discountCents}
                    wrapperClassName="w-36"
                    className="min-h-9"
                    data-autofocus
                  />
                  <Button size="sm" loading={pending} onClick={saveDiscount}>
                    OK
                  </Button>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {t.discount > 0 ? `− ${formatBRL(t.discount)}` : "—"}
                  {edit && (
                    <button
                      type="button"
                      className="text-sm font-semibold text-primary-700 underline-offset-2 hover:underline"
                      onClick={() => setDiscount(t.discount ? centsToInput(t.discount) : "")}
                    >
                      {t.discount ? "alterar" : "dar desconto"}
                    </button>
                  )}
                </span>
              )}
            </dd>
          </div>
          {edit && discount !== null && !can(me.roles, "os.desconto_livre") && (
            <p className="text-sm text-muted">O atendimento dá até 10% do orçamento.</p>
          )}
          <div className="mt-1 flex justify-between text-base font-bold">
            <dt>Total{t.refused > 0 ? " (sem os recusados)" : ""}</dt>
            <dd className="font-display tabular">{formatBRL(t.total)}</dd>
          </div>
          {t.pending > 0 && (
            <p className="text-sm text-warn">{formatBRL(t.pending)} ainda aguardam a decisão do cliente.</p>
          )}
        </dl>
      )}
    </Card>
  );
}

function DiagnosisCard({ w, work }: { w: WorkOrder; work: boolean }) {
  const toast = useToast();
  const { exec, pending } = useAction();
  const [text, setText] = useState(w.diagnosis);
  const dirty = text !== w.diagnosis;
  return (
    <Card className="p-4" aria-labelledby="diagnostico">
      <h2 id="diagnostico" className="mb-2 font-display text-lg font-bold">
        Diagnóstico
      </h2>
      {work ? (
        <div className="grid gap-2">
          <TextAreaField
            label={<span className="sr-only">O que foi encontrado</span>}
            value={text}
            maxLength={2000}
            placeholder="O que o mecânico encontrou. Aparece para o cliente no link do orçamento."
            onChange={(e) => setText(e.target.value)}
          />
          {dirty && (
            <Button
              size="sm"
              className="justify-self-start"
              loading={pending}
              onClick={async () => {
                const r = await exec({ type: "workOrder.diagnosis", id: w.id, text });
                toast({ tone: r.ok ? "success" : "error", text: r.message });
              }}
            >
              Salvar diagnóstico
            </Button>
          )}
        </div>
      ) : (
        <p className="whitespace-pre-line text-sm text-muted">{w.diagnosis || "—"}</p>
      )}
    </Card>
  );
}

function PhotosCard({ w, work, count }: { w: WorkOrder; work: boolean; count: number }) {
  const { data } = useBackend();
  const toast = useToast();
  const { exec, pending } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const photos = data.workOrderPhotos.filter((p) => p.workOrderId === w.id);
  const limit = PHOTO_LIMIT[data.company.plan];

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await prepareWorkOrderPhoto(file);
      const r = await exec({ type: "workOrder.addPhoto", workOrderId: w.id, dataUrl, caption: caption.trim() });
      toast({ tone: r.ok ? "success" : "error", text: r.message });
      if (r.ok) setCaption("");
    } catch (e) {
      toast({ tone: "error", text: e instanceof Error ? e.message : "Não foi possível enviar a foto." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <Card className="p-4" aria-labelledby="fotos">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id="fotos" className="font-display text-lg font-bold">
          Fotos
        </h2>
        <span className="text-sm text-muted">
          {count} de {limit}
        </span>
      </div>
      <p className="mb-3 text-sm text-muted">
        Riscos e amassados na entrada, a peça trocada, o antes e depois. Protegem a oficina e mostram o serviço ao
        cliente.
      </p>
      {photos.length > 0 && (
        <ul className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id}>
              <a
                href={p.url}
                target="_blank"
                rel="noopener"
                className="block overflow-hidden rounded-lg border border-line"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.caption || "Foto da OS"} className="aspect-[4/3] w-full object-cover" />
              </a>
              {p.caption && <p className="mt-1 truncate text-sm text-muted">{p.caption}</p>}
            </li>
          ))}
        </ul>
      )}
      {work &&
        (count >= limit ? (
          <p className="flex items-center gap-1 text-sm text-muted">
            <IconAlert className="h-4 w-4" /> Limite de fotos do plano atingido nesta OS.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              label="Legenda"
              optional
              value={caption}
              maxLength={120}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Ex.: risco na porta traseira"
              wrapperClassName="min-w-0 flex-1"
            />
            <input
              ref={input}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Escolher foto"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <Button variant="secondary" loading={busy || pending} onClick={() => input.current?.click()}>
              Tirar ou escolher foto
            </Button>
          </div>
        ))}
    </Card>
  );
}

function DeliveredCard({ w, items }: { w: WorkOrder; items: WorkOrderItem[] }) {
  const warranties = items
    .map((i) => ({ item: i, until: warrantyUntil(i, w.deliveredAt) }))
    .filter((x) => x.until !== null);
  return (
    <Card className="p-4" aria-labelledby="entrega">
      <h2 id="entrega" className="font-display text-lg font-bold">
        Entrega
      </h2>
      <p className="text-sm">
        Entregue em {formatDateBR(w.deliveredAt)} ·{" "}
        <span className="font-semibold">{formatBRL(w.totalCents ?? 0)}</span>
      </p>
      {w.nextServiceOn && (
        <p className="mt-1 text-sm text-muted">
          Próxima revisão: {w.nextServiceNote || "revisão"} em {formatShortDateBR(w.nextServiceOn)}
        </p>
      )}
      {warranties.length > 0 && (
        <>
          <h3 className="mt-3 text-sm font-semibold">Garantia</h3>
          <ul className="mt-1 grid gap-0.5 text-sm text-muted">
            {warranties.map(({ item, until }) => (
              <li key={item.id}>
                {item.description}: até {formatShortDateBR(until!)}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
