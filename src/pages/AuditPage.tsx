import { useQuery } from "@tanstack/react-query";
import { listAuditLogs } from "@/lib/api";
import { dateLabel } from "@/lib/format";

export function AuditPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ["audit_logs"], queryFn: listAuditLogs });
  return (
    <section className="panel">
      <h2>Auditoria</h2>
      <table>
        <thead><tr><th>Data</th><th>Acao</th><th>Entidade</th><th>ID</th></tr></thead>
        <tbody>
          {isLoading && <tr><td colSpan={4}>Carregando...</td></tr>}
          {data.map((log) => (
            <tr key={log.id}>
              <td>{dateLabel(log.createdAt)}</td>
              <td>{log.action}</td>
              <td>{log.entityType}</td>
              <td>{log.entityId ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
