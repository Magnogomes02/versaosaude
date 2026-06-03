import { useQuery } from "@tanstack/react-query";
import { listCollection } from "@/lib/api";

interface Preference {
  id: string;
  bookingHorizonDays?: number;
  indefiniteContractMonths?: number;
  overdueGraceDaysAfterRevert?: number;
}

export function PreferencesPage() {
  const { data = [] } = useQuery({ queryKey: ["preferences"], queryFn: () => listCollection<Preference>("preferences") });
  const system = data.find((item) => item.id === "system");
  return (
    <section className="panel">
      <h2>Preferencias</h2>
      <div className="settings-grid">
        <div><small>Horizonte inicial de agenda</small><strong>{system?.bookingHorizonDays ?? 90} dias</strong></div>
        <div><small>Recebiveis de contrato indefinido</small><strong>{system?.indefiniteContractMonths ?? 12} meses</strong></div>
        <div><small>Graca apos estorno</small><strong>{system?.overdueGraceDaysAfterRevert ?? 3} dias</strong></div>
      </div>
    </section>
  );
}
