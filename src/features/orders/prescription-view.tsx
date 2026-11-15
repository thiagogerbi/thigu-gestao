import { Badge } from "@/components/ui/card";
import { formatDateBR, formatShortDateBR } from "@/lib/domain/dates";
import { formatDiopter, prescriptionStatus } from "@/lib/domain/orders";
import type { EyeValues, Prescription } from "@/lib/domain/types";

const axis = (n: number | null) => (n === null ? "—" : `${n}°`);

/** Receita em tabela, como o laboratório lê: OD e OE com esférico, cilíndrico, eixo e adição. */
export function PrescriptionView({ p, today }: { p: Prescription; today: string }) {
  const status = prescriptionStatus(p, today);
  const row = (label: string, e: EyeValues, dnp: number | null) => (
    <tr className="border-t border-line">
      <th scope="row" className="py-1 pr-2 text-left font-semibold">
        {label}
      </th>
      <td className="px-2 tabular">{formatDiopter(e.sph)}</td>
      <td className="px-2 tabular">{formatDiopter(e.cyl)}</td>
      <td className="px-2 tabular">{axis(e.axis)}</td>
      <td className="px-2 tabular">{e.add === null ? "—" : formatDiopter(e.add)}</td>
      <td className="px-2 tabular">{dnp === null ? "—" : `${String(dnp).replace(".", ",")} mm`}</td>
    </tr>
  );
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Exame em {formatShortDateBR(p.examinedOn)}
          {p.doctor && ` · ${p.doctor}`}
        </span>
        <Badge tone={status === "vencida" ? "red" : status === "vencendo" ? "amber" : "green"}>
          {status === "vencida" ? "Vencida" : "Válida"} até {formatDateBR(p.validUntil)}
        </Badge>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-muted">
            <tr>
              <th className="sr-only">Olho</th>
              <th className="px-2 text-left font-medium">Esf.</th>
              <th className="px-2 text-left font-medium">Cil.</th>
              <th className="px-2 text-left font-medium">Eixo</th>
              <th className="px-2 text-left font-medium">Adição</th>
              <th className="px-2 text-left font-medium">DNP</th>
            </tr>
          </thead>
          <tbody>
            {row("OD", p.od, p.dnpOd)}
            {row("OE", p.oe, p.dnpOe)}
          </tbody>
        </table>
      </div>
      {p.notes && <p className="mt-2 text-sm text-muted">{p.notes}</p>}
    </div>
  );
}
