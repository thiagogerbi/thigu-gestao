"use client";
import { Button, IconButton } from "@/components/ui/button";
import { IconX } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const layerStack: string[] = [];

function useLayer(open: boolean, ref: React.RefObject<HTMLElement | null>, onEscape: () => void) {
  const esc = useRef(onEscape);
  useEffect(() => {
    esc.current = onEscape;
  }, [onEscape]);
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    layerStack.push(id);
    const previous = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      const target =
        el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
      target.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (layerStack[layerStack.length - 1] !== id) return;
      if (e.key === "Escape") {
        e.preventDefault();
        esc.current();
      } else if (e.key === "Tab" && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (n) => n.offsetParent !== null,
        );
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey);
      const i = layerStack.indexOf(id);
      if (i >= 0) layerStack.splice(i, 1);
      if (layerStack.length === 0) document.body.style.overflow = prevOverflow;
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open, ref]);
}

const noopSubscribe = () => () => {};

/** true somente no navegador (portais precisam de document.body). */
function useMounted() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/** Protege contra perda acidental: pergunta antes de fechar quando há alterações. */
function useDirtyGuard(dirty: boolean, onClose: () => void) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  const requestClose = useCallback(() => (dirty ? setAsking(true) : onClose()), [dirty, onClose]);
  return { asking, setAsking, requestClose };
}

function DiscardBar({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-label="Descartar alterações?"
      className="border-t border-[#f5d9a8] bg-warn-50 px-5 py-3"
    >
      <p className="text-sm font-semibold text-warn">
        Você preencheu informações que ainda não foram salvas. Quer mesmo sair?
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" onClick={onKeep} data-autofocus>
          Continuar preenchendo
        </Button>
        <Button size="sm" variant="secondary" onClick={onDiscard}>
          Sair sem salvar
        </Button>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  dirty = false,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  dirty?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const { asking, setAsking, requestClose } = useDirtyGuard(open && dirty, onClose);
  useLayer(open && mounted, ref, requestClose);
  const titleId = useId();
  const descId = useId();
  if (!open || !mounted) return null;
  const width = { sm: "sm:max-w-md", md: "sm:max-w-xl", lg: "sm:max-w-3xl" }[size];
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-[#0d1b30]/50" onClick={requestClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cx(
          "relative flex max-h-[94vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-bold">
              {title}
            </h2>
            {description && (
              <div id={descId} className="mt-0.5 text-sm text-muted">
                {description}
              </div>
            )}
          </div>
          <IconButton label="Fechar janela" onClick={requestClose} className="-mr-2 -mt-1">
            <IconX />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {asking ? (
          <DiscardBar
            onKeep={() => setAsking(false)}
            onDiscard={() => {
              setAsking(false);
              onClose();
            }}
          />
        ) : (
          footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-3 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )
        )}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  headerActions,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  useLayer(open && mounted, ref, onClose);
  const titleId = useId();
  if (!open || !mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end print:hidden">
      <div className="absolute inset-0 bg-[#0d1b30]/35" onClick={onClose} aria-hidden="true" />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative flex h-full w-full flex-col bg-canvas shadow-2xl sm:max-w-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line bg-white px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted">Ficha do cliente</p>
            <h2 id={titleId} className="truncate text-xl font-bold">
              {title}
            </h2>
            {subtitle && <div className="text-sm text-muted">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1">
            {headerActions}
            <IconButton label="Fechar ficha do cliente" onClick={onClose} className="-mr-2">
              <IconX />
            </IconButton>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
