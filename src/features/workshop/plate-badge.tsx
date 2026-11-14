import { cx } from "@/components/ui/styles";

/** Placa no jeito que o pessoal da oficina reconhece de longe. */
export function PlateBadge({ plate, className }: { plate: string; className?: string }) {
  if (!plate) return null;
  return (
    <span
      className={cx(
        "inline-flex items-center rounded border border-ink/40 bg-white px-1.5 py-0.5 font-mono text-sm font-bold tracking-wider text-ink",
        className,
      )}
    >
      {plate}
    </span>
  );
}
