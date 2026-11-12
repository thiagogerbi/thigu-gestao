"use client";
import { IconSpinner } from "@/components/ui/icons";
import { buttonClass, cx, type SIZE, type Variant } from "@/components/ui/styles";
import Link from "next/link";

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof SIZE; loading?: boolean }) {
  return (
    <button
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <IconSpinner />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: React.ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof SIZE }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

/** Botão só com ícone: exige um nome acessível. */
export function IconButton({
  label,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
