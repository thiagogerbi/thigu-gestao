"use client";
import { IconAlert, IconCheckCircle } from "@/components/ui/icons";
import { cx } from "@/components/ui/styles";

export function Card({
  className,
  children,
  as: As = "section",
  ...rest
}: React.HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "li" }) {
  return (
    <As className={cx("rounded-2xl border border-line bg-white shadow-card", className)} {...rest}>
      {children}
    </As>
  );
}

type Tone = "neutral" | "blue" | "green" | "amber" | "red" | "gray" | "navy";
const TONE: Record<Tone, string> = {
  neutral: "bg-canvas text-ink border-line",
  blue: "bg-primary-50 text-primary-700 border-primary/25",
  green: "bg-money-50 text-money-700 border-[#bfe8d8]",
  amber: "bg-warn-50 text-warn border-[#f5d9a8]",
  red: "bg-danger-50 text-danger border-[#f7c9c4]",
  gray: "bg-[#f1f3f6] text-muted border-line",
  navy: "bg-navy text-white border-navy",
};
export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-medium",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[26px] font-extrabold leading-tight text-ink sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-muted">{description}</p>}
      </div>
      {/* no celular a ação principal ocupa a largura toda: mais fácil de acertar com o polegar */}
      {actions && <div className="flex flex-wrap gap-2 *:flex-1 sm:*:flex-none">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-[#c5cfdf] bg-white px-6 py-10 text-center">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-muted">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function InlineAlert({
  tone = "red",
  title,
  children,
}: {
  tone?: "red" | "amber" | "blue" | "green";
  title?: string;
  children: React.ReactNode;
}) {
  const map = {
    red: "border-[#f7c9c4] bg-danger-50 text-danger",
    amber: "border-[#f5d9a8] bg-warn-50 text-warn",
    blue: "border-primary/25 bg-primary-50 text-primary-700",
    green: "border-[#bfe8d8] bg-money-50 text-money-700",
  };
  return (
    <div
      role={tone === "red" ? "alert" : "status"}
      className={cx("flex gap-2 rounded-lg border px-3 py-2.5 text-sm", map[tone])}
    >
      {tone === "green" ? (
        <IconCheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
