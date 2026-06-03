import { useQuery } from "@tanstack/react-query";
import { listBookings } from "@/lib/api";
import { dateLabel } from "@/lib/format";

export function CalendarPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ["bookings"], queryFn: listBookings });
  return (
    <section className="panel">
      <h2>Calendario</h2>
      <table>
        <thead><tr><th>Inicio</th><th>Fim</th><th>Sala</th><th>Status</th></tr></thead>
        <tbody>
          {isLoading && <tr><td colSpan={4}>Carregando...</td></tr>}
          {data.map((booking) => (
            <tr key={booking.id}>
              <td>{dateLabel(booking.startAt)}</td>
              <td>{dateLabel(booking.endAt)}</td>
              <td>{booking.roomId}</td>
              <td><span className={`badge ${booking.status}`}>{booking.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
