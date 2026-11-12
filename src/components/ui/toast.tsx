"use client";
import { IconAlert, IconCheckCircle, IconX } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";
import { createContext, useCallback, useContext, useState } from "react";

interface Toast {
  id: number;
  tone: "success" | "error" | "info";
  text: string;
}
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.tone === "error" ? 9000 : 6500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-4 print:hidden"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex max-w-md items-start gap-2 rounded-xl px-4 py-3 text-[15px] font-medium shadow-lg",
              t.tone === "success" && "bg-money-700 text-white",
              t.tone === "error" && "bg-danger text-white",
              t.tone === "info" && "bg-navy text-white",
            )}
          >
            {t.tone === "success" ? (
              <IconCheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
            ) : (
              <IconAlert className="mt-0.5 h-5 w-5 shrink-0" />
            )}
            <span>{t.text}</span>
            <button
              type="button"
              className="ml-2 rounded px-1 text-white/85 hover:text-white"
              aria-label="Fechar aviso"
              onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
