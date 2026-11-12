"use client";

import { ThiguLogo, ThiguMark } from "@/components/brand/thigu-logo";
import { DialogHost } from "@/components/layout/dialog-host";
import { Button } from "@/components/ui/button";
import { IconBuilding, IconCheck, IconColumns, IconHome, IconUsers, IconWallet } from "@/components/ui/icons";
import { Modal } from "@/components/ui/overlay";
import { cx } from "@/components/ui/styles";
import { ToastProvider } from "@/components/ui/toast";
import { ClientDrawer } from "@/features/clients/client-drawer";
import { can, usesCrm } from "@/lib/domain/permissions";
import { ROLE_LABEL } from "@/lib/domain/types";
import { useBackend } from "@/state/backend-context";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";

function useNavItems() {
  const { me, basePath } = useBackend();
  const items = [
    { href: basePath, label: "Visão geral", icon: IconHome, show: true },
    { href: `${basePath}/clientes`, label: "Clientes", icon: IconUsers, show: usesCrm(me.roles) },
    { href: `${basePath}/negociacoes`, label: "Negociações", icon: IconColumns, show: usesCrm(me.roles) },
    { href: `${basePath}/tarefas`, label: "Tarefas", icon: IconCheck, show: true },
    {
      href: `${basePath}/financeiro`,
      label: "Financeiro",
      icon: IconWallet,
      show: can(me.roles, "financeiro.ver") || can(me.roles, "recebiveis.ver_proprios"),
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
    active ? "bg-primary text-white shadow-sm" : "text-[#dbe4f3] hover:bg-navy-700 hover:text-white",
  );

function CompanySwitcher({ dark }: { dark?: boolean }) {
  const { companies, data, switchCompany } = useBackend();
  if (companies.length <= 1) {
    return (
      <p className={cx("truncate text-sm font-semibold", dark ? "text-white" : "text-ink")}>{data.company.name}</p>
    );
  }
  return (
    <label className="block">
      <span
        className={cx(
          "mb-1 block text-[12px] font-semibold uppercase tracking-wide",
          dark ? "text-[#c9d6ea]" : "text-muted",
        )}
      >
        Minha empresa
      </span>
      <select
        value={data.company.id}
        onChange={(e) => switchCompany(e.target.value)}
        className={cx(
          "min-h-10 w-full rounded-lg border px-2 text-sm font-semibold",
          dark ? "border-navy-600 bg-navy-700 text-white" : "border-line bg-white text-ink",
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

function Sidebar() {
  const { me, basePath, signOut } = useBackend();
  const pathname = usePathname();
  const items = useNavItems();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-navy px-4 py-5 text-white lg:flex print:hidden">
      <Link href={basePath} className="mb-6 rounded-lg px-1">
        <ThiguLogo dark />
      </Link>
      <div className="mb-5">
        <CompanySwitcher dark />
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
        <p className="text-[#c9d6ea]">{me.roles.map((r) => ROLE_LABEL[r]).join(", ")}</p>
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
  const { basePath } = useBackend();
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-white px-4 py-2 lg:hidden print:hidden">
      <Link href={basePath} className="shrink-0 rounded-lg" aria-label="Thigu Gestão — Visão geral">
        <ThiguMark className="h-9 w-9" />
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

function MobileNav() {
  const { basePath } = useBackend();
  const pathname = usePathname();
  const items = useNavItems();
  return (
    <nav
      aria-label="Menu principal"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white pb-[env(safe-area-inset-bottom)] lg:hidden print:hidden"
    >
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => {
          const active = isActive(pathname, it.href, basePath);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-16 flex-col items-center justify-center gap-0.5 px-1 text-[12px] font-medium",
                  active ? "text-primary" : "text-muted",
                )}
              >
                <it.icon className="h-6 w-6" />
                <span className="truncate">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function PreviewBanner() {
  const { preview, me } = useBackend();
  const [confirming, setConfirming] = useState(false);
  if (!preview) return null;
  return (
    <div
      className="border-b border-[#f5d9a8] bg-warn-50 px-4 py-2.5 text-[14px] text-[#6b4106] lg:px-8 print:hidden"
      role="region"
      aria-label="Aviso da prévia"
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="flex-1 basis-72">
          <strong>Prévia com dados fictícios.</strong> Nada é salvo nem enviado: as alterações ficam só nesta aba e
          somem ao recarregar a página.
        </p>
        <label className="flex items-center gap-2">
          <span className="font-semibold">Ver como:</span>
          <select
            value={me.userId}
            onChange={(e) => preview.setPersona(e.target.value)}
            className="min-h-9 rounded-lg border border-[#e4c487] bg-white px-2 text-ink"
          >
            {preview.personas.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name} ({p.roles.map((r) => ROLE_LABEL[r]).join(", ")})
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          Restaurar exemplo
        </Button>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Restaurar o exemplo?"
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
              Restaurar exemplo
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
