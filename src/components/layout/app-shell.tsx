"use client";

import { CompanyMark } from "@/components/brand/company-mark";
import { DialogHost } from "@/components/layout/dialog-host";
import { Button } from "@/components/ui/button";
import {
  IconBuilding,
  IconCalendar,
  IconCheck,
  IconColumns,
  IconGroup,
  IconHome,
  IconMenu,
  IconPercent,
  IconRegister,
  IconRepeat,
  IconUndo,
  IconUsers,
  IconWallet,
} from "@/components/ui/icons";
import { Modal } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { ToastProvider } from "@/components/ui/toast";
import { ClientDrawer } from "@/features/clients/client-drawer";
import { PreviewTour, type TourMode } from "@/features/tour/preview-tour";
import { brandCss } from "@/lib/domain/branding";
import { can, usesAgenda, usesClients, usesCrm } from "@/lib/domain/permissions";
import { moduleAvailable } from "@/lib/domain/segments";
import type { Role } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";
import { useRecurring } from "@/state/use-recurring";
import { useTerms } from "@/state/use-terms";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState, useSyncExternalStore } from "react";

function useNavItems() {
  const { me, basePath, data } = useBackend();
  const t = useTerms();
  const rec = useRecurring();
  const items = [
    { href: basePath, label: "Visão geral", icon: IconHome, show: true },
    {
      href: `${basePath}/agenda`,
      label: "Agenda",
      icon: IconCalendar,
      show: moduleAvailable(data.company, "agenda") && usesAgenda(me.roles),
    },
    { href: `${basePath}/clientes`, label: t.Clientes, icon: IconUsers, show: usesClients(me.roles) },
    {
      href: `${basePath}/recorrentes`,
      label: rec.label,
      icon: IconRepeat,
      show: rec.enabled && (rec.canSell || rec.seesMoney),
    },
    {
      href: `${basePath}/turmas`,
      label: "Turmas",
      icon: IconGroup,
      show:
        moduleAvailable(data.company, "turmas") &&
        (can(me.roles, "turmas.gerenciar") ||
          can(me.roles, "turmas.matricular") ||
          data.classes.some((c) => data.resources.some((r) => r.id === c.resourceId && r.userId === me.userId))),
    },
    {
      href: `${basePath}/caixa`,
      label: "Caixa",
      icon: IconRegister,
      show: moduleAvailable(data.company, "caixa") && can(me.roles, "caixa.operar"),
    },
    { href: `${basePath}/negociacoes`, label: "Negociações", icon: IconColumns, show: usesCrm(me.roles) },
    { href: `${basePath}/tarefas`, label: "Tarefas", icon: IconCheck, show: true },
    {
      href: `${basePath}/financeiro`,
      label: "Financeiro",
      icon: IconWallet,
      show: can(me.roles, "financeiro.ver") || can(me.roles, "recebiveis.ver_proprios"),
    },
    {
      href: `${basePath}/comissoes`,
      label: "Comissões",
      icon: IconPercent,
      show:
        moduleAvailable(data.company, "comissoes") &&
        (can(me.roles, "comissoes.ver_todas") || data.resources.some((r) => r.userId === me.userId)),
    },
  ];
  return items.filter((i) => i.show);
}

function isActive(pathname: string, href: string, basePath: string) {
  return href === basePath ? pathname === basePath : pathname.startsWith(href);
}

const navItemClass = (active: boolean) =>
  cx(
    "flex min-h-11 items-center gap-3 rounded-lg px-3 font-medium",
    // o anel branco mantém o item ativo visível mesmo quando o menu e a marca têm cores parecidas
    active
      ? "bg-primary text-white shadow-sm ring-1 ring-white/40"
      : "text-white/85 hover:bg-navy-700 hover:text-white",
  );

function CompanySwitcher({ dark, hideSingle }: { dark?: boolean; hideSingle?: boolean }) {
  const { companies, data, switchCompany } = useBackend();
  if (companies.length <= 1) {
    if (hideSingle) return null;
    return (
      <p className={cx("truncate font-display text-base font-bold", dark ? "text-white" : "text-ink")}>
        {data.company.name}
      </p>
    );
  }
  return (
    <label className="block">
      {/* no celular o nome da empresa já é o título da barra; o rótulo fica só para leitores de tela */}
      <span className={cx("mb-1 block text-sm font-semibold", dark ? "text-white/75" : "sr-only")}>Minha empresa</span>
      <select
        value={data.company.id}
        onChange={(e) => switchCompany(e.target.value)}
        className={cx(
          "w-full rounded-lg border font-semibold",
          dark
            ? "min-h-10 border-navy-600 bg-navy-700 px-2 text-sm text-white"
            : "min-h-11 truncate border-transparent bg-transparent px-1 font-display font-bold text-ink hover:bg-canvas",
        )}
        aria-label="Trocar de empresa"
      >
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Troca os tons do tema (ações e menu) pelas cores da empresa; vale também para janelas abertas fora do menu. */
function BrandTheme() {
  const { data } = useBackend();
  const css = brandCss(data.company.brandColor, data.company.menuColor);
  return css ? <style>{css}</style> : null;
}

function Sidebar() {
  const { me, basePath, signOut, data } = useBackend();
  const pathname = usePathname();
  const items = useNavItems();
  const t = useTerms();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy px-4 py-5 text-white lg:flex print:hidden">
      <Link href={basePath} className="mb-4 block rounded-lg" aria-label={`${data.company.name} — Visão geral`}>
        <CompanyMark name={data.company.name} logoDataUrl={data.company.logoDataUrl} variant="menu" />
      </Link>
      <div className="mb-5">
        <CompanySwitcher dark hideSingle />
      </div>
      <nav aria-label="Menu principal" className="flex-1">
        <ul className="grid gap-1">
          {items.map((it) => {
            const active = isActive(pathname, it.href, basePath);
            return (
              <li key={it.href}>
                <Link href={it.href} aria-current={active ? "page" : undefined} className={navItemClass(active)}>
                  <it.icon /> {it.label}
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href={`${basePath}/empresa`}
              aria-current={pathname.startsWith(`${basePath}/empresa`) ? "page" : undefined}
              className={navItemClass(pathname.startsWith(`${basePath}/empresa`))}
            >
              <IconBuilding /> Minha empresa
            </Link>
          </li>
        </ul>
      </nav>
      <div className="rounded-lg bg-navy-700 p-3 text-sm">
        <p className="font-semibold">{me.name}</p>
        <p className="text-white/75">{t.roleLabels(me.roles)}</p>
        {signOut && (
          <button
            type="button"
            onClick={() => signOut()}
            className="mt-2 min-h-9 font-semibold text-white underline underline-offset-2"
          >
            Sair
          </button>
        )}
      </div>
    </aside>
  );
}

function MobileTop() {
  const { basePath, data } = useBackend();
  return (
    <div className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-white/90 pl-4 pr-2 backdrop-blur-md lg:hidden print:hidden">
      <Link href={basePath} className="shrink-0 rounded-lg" aria-label={`${data.company.name} — Visão geral`}>
        <CompanyMark name={data.company.name} logoDataUrl={data.company.logoDataUrl} variant="compacto" />
      </Link>
      <div className="min-w-0 flex-1">
        <CompanySwitcher />
      </div>
      <Link
        href={`${basePath}/empresa`}
        className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas"
        aria-label="Minha empresa"
      >
        <IconBuilding />
      </Link>
    </div>
  );
}

/** No celular cabem 5 botões; o que passar disso vai para "Mais". */
const MOBILE_SLOTS = 5;

function MobileNav() {
  const { basePath } = useBackend();
  const pathname = usePathname();
  const all = useNavItems();
  const [moreOpen, setMoreOpen] = useState(false);
  const overflow = all.length > MOBILE_SLOTS;
  const items = overflow ? all.slice(0, MOBILE_SLOTS - 1) : all;
  const more = overflow ? all.slice(MOBILE_SLOTS - 1) : [];
  const moreActive = more.some((it) => isActive(pathname, it.href, basePath));
  return (
    <nav
      aria-label="Menu principal"
      className="fixed inset-x-0 bottom-0 z-30 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-bar backdrop-blur-md lg:hidden print:hidden"
    >
      {moreOpen && (
        <ul
          id="menu-mais"
          className="absolute inset-x-2 bottom-full mb-2 grid gap-1 rounded-2xl border border-line bg-white p-2 shadow-raised"
        >
          {more.map((it) => {
            const active = isActive(pathname, it.href, basePath);
            return (
              <li key={it.href}>
                <Link
                  href={it.href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex min-h-12 items-center gap-3 rounded-lg px-3",
                    active ? "bg-primary-50 font-semibold text-primary-700" : "text-ink hover:bg-canvas",
                  )}
                >
                  <it.icon className="h-5 w-5" /> {it.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <ul
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length + (overflow ? 1 : 0)}, minmax(0, 1fr))` }}
      >
        {items.map((it) => {
          const active = isActive(pathname, it.href, basePath);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] leading-4",
                  active ? "font-semibold text-primary-700" : "font-medium text-muted",
                )}
              >
                {/* a "pílula" atrás do ícone mostra onde a pessoa está sem depender só da cor do texto */}
                <span
                  className={cx(
                    "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150",
                    active && "bg-primary-50",
                  )}
                >
                  <it.icon className="h-[22px] w-[22px]" />
                </span>
                <span className="max-w-full truncate">{it.label}</span>
              </Link>
            </li>
          );
        })}
        {overflow && (
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              aria-controls="menu-mais"
              className={cx(
                "flex min-h-16 w-full flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] leading-4",
                moreActive || moreOpen ? "font-semibold text-primary-700" : "font-medium text-muted",
              )}
            >
              <span
                className={cx(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150",
                  (moreActive || moreOpen) && "bg-primary-50",
                )}
              >
                <IconMenu className="h-[22px] w-[22px]" />
              </span>
              <span>Mais</span>
            </button>
          </li>
        )}
      </ul>
    </nav>
  );
}

/** Como cada papel aparece na prévia, em linguagem do dia a dia. */
const PERSONA_HINT: Record<Role, string> = {
  admin: "dona da empresa, pode fazer tudo",
  gestor: "acompanha a equipe de vendas",
  vendedor: "cuida dos próprios clientes",
  financeiro: "cuida do dinheiro",
  recepcao: "atende e cadastra para toda a equipe",
  profissional: "atende os próprios clientes",
  caixa: "recebe no balcão",
};

const TOUR_CLOSED_KEY = "thigu:guia-fechado";
const noSubscription = () => () => {};
function readTourClosed() {
  try {
    return window.sessionStorage.getItem(TOUR_CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}

function PreviewBanner() {
  const { preview, me } = useBackend();
  const [confirming, setConfirming] = useState(false);
  // "auto": aberto em telas grandes e fechado no celular, para não cobrir a tela logo de início.
  // Se a pessoa fechou o guia, ele não reabre a cada recarregamento da página (vale para a aba do navegador).
  const closedBefore = useSyncExternalStore(noSubscription, readTourClosed, () => false);
  const [tourChoice, setTourChoice] = useState<TourMode | null>(null);
  const tour: TourMode = tourChoice ?? (closedBefore ? "closed" : "auto");
  const setTour = (mode: TourMode) => {
    try {
      window.sessionStorage.setItem(TOUR_CLOSED_KEY, mode === "closed" ? "1" : "0");
    } catch {
      // navegação privada pode bloquear o armazenamento; o guia só deixa de lembrar
    }
    setTourChoice(mode);
  };
  if (!preview) return null;
  return (
    <div
      className="border-b border-[#f5d9a8] bg-warn-50 px-4 py-2.5 text-sm text-[#6b4106] lg:px-8 print:hidden"
      role="region"
      aria-label="Aviso da prévia"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex-1 basis-full md:basis-72">
          <strong>Isto é uma demonstração com dados de exemplo.</strong> Pode clicar à vontade: nada é salvo nem
          enviado.
        </p>
        {/* no celular, quem experimenta e os dois botões cabem numa linha só */}
        <div className="flex w-full items-center gap-2 md:w-auto">
          <label className="flex min-w-0 flex-1 items-center gap-2">
            <span className="sr-only shrink-0 font-semibold md:not-sr-only">Experimente como:</span>
            <select
              value={me.userId}
              onChange={(e) => preview.setPersona(e.target.value)}
              aria-label="Experimente como"
              className="min-h-11 w-full min-w-0 truncate rounded-lg border border-[#e4c487] bg-white px-2 font-medium text-ink md:min-h-10 md:w-auto md:font-normal"
            >
              {preview.personas.map((p) => (
                <option key={p.userId} value={p.userId}>
                  {p.name} — {p.roles.map((r) => PERSONA_HINT[r]).join(", ")}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            className="shrink-0"
            onClick={() => setTour("open")}
            aria-expanded={tour === "open" || tour === "auto"}
            aria-label="Guia passo a passo"
          >
            <span className="md:hidden">Guia</span>
            <span className="hidden md:inline">Guia passo a passo</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="shrink-0 max-md:w-11 max-md:px-0"
            onClick={() => setConfirming(true)}
            aria-label="Recomeçar exemplo"
            title="Recomeçar exemplo"
          >
            <IconUndo className="h-5 w-5 md:hidden" />
            <span className="hidden md:inline">Recomeçar exemplo</span>
          </Button>
        </div>
      </div>
      <PreviewTour mode={tour} onMode={setTour} />
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Recomeçar o exemplo?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                preview.reset();
                setConfirming(false);
              }}
            >
              Recomeçar exemplo
            </Button>
          </>
        }
      >
        <p>
          Tudo o que você fez na prévia será descartado e os dados fictícios voltam ao início. Isso não afeta nenhum
          dado real.
        </p>
      </Modal>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <Suspense>
        <DialogHost>
          <BrandTheme />
          <a
            href="#conteudo"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lg"
          >
            Pular para o conteúdo
          </a>
          <Sidebar />
          <div className="lg:pl-64 print:pl-0">
            <MobileTop />
            <PreviewBanner />
            <main
              id="conteudo"
              tabIndex={-1}
              className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 lg:px-8 lg:pb-12 print:p-0"
            >
              {children}
            </main>
          </div>
          <MobileNav />
          <ClientDrawer />
        </DialogHost>
      </Suspense>
    </ToastProvider>
  );
}
