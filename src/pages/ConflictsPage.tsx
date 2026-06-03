import { useQuery } from "@tanstack/react-query";
import { listCollection } from "@/lib/api";

interface Conflict {
  id: string;
  bookingIdA: string;
  bookingIdB: string;
  roomId: string;
  status: string;
}

export function ConflictsPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ["booking_conflicts"], queryFn: () => listCollection<Conflict>("booking_conflicts") });
  return (
    <section className="panel">
      <h2>Conflitos</h2>
      <table>
        <thead><tr><th>Reserva A</th><th>Reserva B</th><th>Sala</th><th>Status</th></tr></thead>
        <tbody>
          {isLoading && <tr><td colSpan={4}>Carregando...</td></tr>}
          {data.map((conflict) => (
            <tr key={conflict.id}>
              <td>{conflict.bookingIdA}</td>
              <td>{conflict.bookingIdB}</td>
              <td>{conflict.roomId}</td>
              <td>{conflict.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
