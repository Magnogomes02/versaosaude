import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callIssueReceipt, callRecordPayment, callRevertPayment, listCollection, listReceivables } from "@/lib/api";
import { brl } from "@/lib/format";
import { useAuth } from "@/providers/AuthProvider";
import type { Receivable } from "@/types";

interface Payment {
  id: string;
  receivableId: string;
  amount: number;
  paidAt: string;
  status: "active" | "reverted";
}

export function FinancePage() {
  const queryClient = useQueryClient();
  const { isGestor } = useAuth();
  const [selected, setSelected] = useState<Receivable | null>(null);
  const [revertTarget, setRevertTarget] = useState<Payment | null>(null);
  const [revertReason, setRevertReason] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("PIX");
  const receivables = useQuery({ queryKey: ["receivables"], queryFn: () => listReceivables() });
  const payments = useQuery({ queryKey: ["receivable_payments"], queryFn: () => listCollection<Payment>("receivable_payments", 200) });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["receivables"] });
    queryClient.invalidateQueries({ queryKey: ["receivable_payments"] });
  };

  const recordPayment = useMutation({
    mutationFn: async (receivable: Receivable) => callRecordPayment({
      receivableId: receivable.id,
      paymentInput: {
        amount: Number(amount),
        paidAt: new Date().toISOString(),
        method,
      },
    }),
    onSuccess: () => {
      setSelected(null);
      setAmount("");
      refresh();
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await recordPayment.mutateAsync(selected);
  }

  async function issueReceipt(receivableId: string) {
    await callIssueReceipt({ receivableId });
    refresh();
  }

  async function confirmRevert() {
    if (!revertTarget || !revertReason.trim()) return;
    await callRevertPayment({ paymentId: revertTarget.id, reason: revertReason.trim() });
    setRevertTarget(null);
    setRevertReason("");
    refresh();
  }

  const rows = receivables.data ?? [];
  const totals = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + Number(row.amountDue || 0);
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <div className="metric warn"><small>Abertos</small><strong>{brl((totals.open ?? 0) + (totals.partial ?? 0))}</strong></div>
        <div className="metric danger"><small>Atrasados</small><strong>{brl(totals.overdue ?? 0)}</strong></div>
        <div className="metric ok"><small>Recebidos</small><strong>{brl(totals.paid ?? 0)}</strong></div>
      </section>
      <section className="panel">
        <h2>Recebiveis</h2>
        <table>
          <thead><tr><th>Mes</th><th>Profissional</th><th>Valor</th><th>Pago</th><th>Status</th><th>Acoes</th></tr></thead>
          <tbody>
            {receivables.isLoading && <tr><td colSpan={6}>Carregando...</td></tr>}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.referenceMonth}</td>
                <td>{row.professionalId}</td>
                <td>{brl(row.amountDue)}</td>
                <td>{brl(row.amountPaid)}</td>
                <td><span className={`badge ${row.status}`}>{row.status}</span></td>
                <td className="actions">
                  {row.status !== "paid" && row.status !== "cancelled" && <button disabled={!isGestor} onClick={() => { setSelected(row); setAmount(String(Math.max(0, Number(row.amountDue) - Number(row.amountPaid ?? 0)))); }}>Baixar</button>}
                  {row.status === "paid" && <button disabled={!isGestor} onClick={() => issueReceipt(row.id)}>Recibo</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Pagamentos</h2>
        <table>
          <thead><tr><th>Recebivel</th><th>Valor</th><th>Data</th><th>Status</th><th>Acoes</th></tr></thead>
          <tbody>
            {(payments.data ?? []).map((payment) => (
              <tr key={payment.id}>
                <td>{payment.receivableId}</td>
                <td>{brl(payment.amount)}</td>
                <td>{payment.paidAt?.slice(0, 10)}</td>
                <td>{payment.status}</td>
                <td>{payment.status === "active" && <button disabled={!isGestor} onClick={() => setRevertTarget(payment)}>Estornar</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {selected && (
        <div className="modal-backdrop">
          <form className="modal" onSubmit={submit}>
            <h2>Registrar pagamento</h2>
            <p>{selected.referenceMonth} - restante {brl(Number(selected.amountDue) - Number(selected.amountPaid ?? 0))}</p>
            <label>Valor<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label>Metodo<select value={method} onChange={(e) => setMethod(e.target.value)}><option>PIX</option><option>Dinheiro</option><option>Transferencia</option><option>Cartao</option><option>Boleto</option></select></label>
            {recordPayment.error && <div className="alert danger">{recordPayment.error.message}</div>}
            <div className="actions end"><button type="button" onClick={() => setSelected(null)}>Cancelar</button><button className="primary-button">Confirmar</button></div>
          </form>
        </div>
      )}

      {revertTarget && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Estornar pagamento</h2>
            <p className="muted">O recibo ativo vinculado sera invalidado visualmente e o recebivel voltara ao status correto.</p>
            <label>
              Motivo do estorno
              <textarea rows={4} value={revertReason} onChange={(e) => setRevertReason(e.target.value)} autoFocus />
            </label>
            <div className="actions end">
              <button type="button" onClick={() => { setRevertTarget(null); setRevertReason(""); }}>Voltar</button>
              <button className="primary-button" disabled={!revertReason.trim()} onClick={confirmRevert}>Confirmar estorno</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
