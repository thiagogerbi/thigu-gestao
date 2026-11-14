"use client";
import { cx } from "@/components/ui/styles";
import { formatBRL } from "@/lib/domain/money";
import Link from "next/link";

export function KpiCard({
  label,
  value,
  help,
  tone = "ink",
  href,
  icon,
}: {
  label: string;
  value: number;
  help: string;
  tone?: "ink" | "money" | "danger" | "primary";
  href?: string;
  icon?: React.ReactNode;
}) {
  const color = { ink: "text-ink", money: "text-money-700", danger: "text-danger", primary: "text-primary-700" }[tone];
  const iconColor = {
    ink: "bg-[#eef2f8] text-navy",
    money: "bg-money-50 text-money-700",
    danger: "bg-danger-50 text-danger",
    primary: "bg-primary-50 text-primary",
  }[tone];
  const body = (
    <>
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        {icon && <span className={cx("flex h-7 w-7 items-center justify-center rounded-md", iconColor)}>{icon}</span>}
        {label}
      </p>
      <p className={cx("mt-2 font-display text-2xl font-extrabold tabular", color)}>{formatBRL(value)}</p>
      <p className="mt-1 text-sm text-muted">{help}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-line bg-white p-4 hover:border-primary">
      {body}
    </Link>
  ) : (
    <div className="rounded-xl border border-line bg-white p-4">{body}</div>
  );
}
