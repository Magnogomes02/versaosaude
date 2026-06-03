import { useQuery } from "@tanstack/react-query";
import { listBookings, listContracts, listProfessionals, listReceivables, listRooms } from "@/lib/api";
import { brl } from "@/lib/format";

export function DashboardPage() {
  const professionals = useQuery({ queryKey: ["professionals"], queryFn: listProfessionals });
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: listRooms });
  const contracts = useQuery({ queryKey: ["contracts"], queryFn: listContracts });
  const bookings = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  const receivables = useQuery({ queryKey: ["receivables"], queryFn: () => listReceivables() });

  const recs = receivables.data ?? [];
  const open = recs.filter((r) => r.status === "open" || r.status === "partial" || r.status === "overdue");
  const paid = recs.filter((r) => r.status === "paid");

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <Metric label="Profissionais ativos" value={professionals.data?.length ?? 0} />
        <Metric label="Salas cadastradas" value={rooms.data?.length ?? 0} />
        <Metric label="Contratos" value={contracts.data?.length ?? 0} />
        <Metric label="Reservas futuras" value={bookings.data?.length ?? 0} />
      </section>
      <section className="metric-grid two">
        <Metric label="A receber" value={brl(open.reduce((sum, r) => sum + Number(r.amountDue || 0), 0))} tone="warn" />
        <Metric label="Recebido" value={brl(paid.reduce((sum, r) => sum + Number(r.amountPaid || 0), 0))} tone="ok" />
      </section>
      <section className="panel">
        <h2>Prioridade da V2</h2>
        <div className="check-list">
          <span>Pagamentos parciais com historico por parcela</span>
          <span>Cancelamento de contrato sem perda de recibos</span>
          <span>Reajuste aplicado somente a recebiveis futuros nao pagos</span>
          <span>Bookings futuros cancelados ao encerrar contrato</span>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return (
    <div className={`metric ${tone ?? ""}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}
