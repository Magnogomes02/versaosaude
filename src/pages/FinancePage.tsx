import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callIssueReceipt, callRecordPayment, callRevertPayment, listPayments, listReceipts, listReceivables } from "@/lib/api";
import { brl } from "@/lib/format";
import { useAuth } from "@/providers/AuthProvider";
import type { Receivable, ReceivablePayment, ReceivableStatus } from "@/types";

type Tab = ReceivableStatus | "all";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "open", label: "A receber" },
  { id: "partial", label: "Parcial" },
  { id: "paid", label: "Recebidos" },
  { id: "overdue", label: "Em atraso" },
  { id: "cancelled", label: "Perdas" },
  { id: "all", label: "Todos" },
];

export function FinancePage() {
  const queryClient = useQueryClient();
  const { isGestor } = useAuth();
  const [selected, setSelected] = useState<Receivable | null>(null);
  const [revertTarget, setRevertTarget] = useState<ReceivablePayment | null>(null);
  const [revertReason, setRevertReason] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("PIX");
  const [lateFeeAmount, setLateFeeAmount] = useState("0");
  const [interestAmount, setInterestAmount] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [activeTab, setActiveTab] = useState<Tab>("open");
  const [message, setMessage] = useState("");
  const receivables = useQuery({ queryKey: ["receivables"], queryFn: () => listReceivables() });
  const payments = useQuery({ queryKey: ["receivable_payments"], queryFn: listPayments });
  const receipts = useQuery({ queryKey: ["receivable_receipts"], queryFn: listReceipts });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["receivables"] });
    queryClient.invalidateQueries({ queryKey: ["receivable_payments"] });
    queryClient.invalidateQueries({ queryKey: ["receivable_receipts"] });
  };

  const recordPayment = useMutation({
    mutationFn: async (receivable: Receivable) => callRecordPayment({
      receivableId: receivable.id,
      paymentInput: {
        baseAmount: Number(amount),
        lateFeeAmount: Number(lateFeeAmount),
        interestAmount: Number(interestAmount),
        discountAmount: Number(discountAmount),
        paidAt: new Date().toISOString(),
        paymentMethod: method,
      },
    }),
    onSuccess: () => {
      setSelected(null);
      setAmount("");
      setLateFeeAmount("0");
      setInterestAmount("0");
      setDiscountAmount("0");
      refresh();
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    await recordPayment.mutateAsync(selected);
  }

  async function issueReceipt(paymentId: string) {
    const result = await callIssueReceipt({ paymentId });
    const data = result.data as { receiptNumber?: string };
    setMessage(`Recibo emitido ${data.receiptNumber ?? ""}`.trim());
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
  const filteredRows = activeTab === "all" ? rows : rows.filter((row) => row.status === activeTab);
  const paymentRows = payments.data ?? [];
  const totals = rows.reduce((acc, row) => {
    const amountDue = Number(row.amountDue || 0);
    const amountPaid = Number(row.amountPaid || 0);
    acc.gross += amountDue;
    acc.received += amountPaid;
    acc.lateFees += Number(row.totalLateFees || 0) + Number(row.totalInterest || 0);
    acc.discounts += Number(row.totalDiscounts || 0);
    if (row.status === "cancelled") acc.loss += amountDue;
    if (row.status === "overdue") acc.overdue += Math.max(0, amountDue - amountPaid);
    if (row.status === "open") acc.open += amountDue;
    if (row.status === "partial") {
      acc.partialReceived += amountPaid;
      acc.partialBalance += Math.max(0, amountDue - amountPaid);
    }
    return acc;
  }, { gross: 0, received: 0, partialReceived: 0, partialBalance: 0, open: 0, overdue: 0, loss: 0, lateFees: 0, discounts: 0 });
  const collectionRate = totals.gross ? (totals.received / totals.gross) * 100 : 0;
  const lossRate = totals.gross ? (totals.loss / totals.gross) * 100 : 0;

  return (
    <div className="page-stack">
      <section className="metric-grid">
        <div className="metric"><small>Previsto bruto</small><strong>{brl(totals.gross)}</strong></div>
        <div className="metric ok"><small>Recebido</small><strong>{brl(totals.received)}</strong></div>
        <div className="metric warn"><small>Parcial recebido</small><strong>{brl(totals.partialReceived)}</strong></div>
        <div className="metric warn"><small>Saldo parcial</small><strong>{brl(totals.partialBalance)}</strong></div>
        <div className="metric"><small>A receber</small><strong>{brl(totals.open)}</strong></div>
        <div className="metric danger"><small>Em atraso</small><strong>{brl(totals.overdue)}</strong></div>
        <div className="metric danger"><small>Perda</small><strong>{brl(totals.loss)}</strong></div>
        <div className="metric"><small>Multas/Juros</small><strong>{brl(totals.lateFees)}</strong></div>
        <div className="metric"><small>Descontos</small><strong>{brl(totals.discounts)}</strong></div>
        <div className="metric ok"><small>Recebimento</small><strong>{collectionRate.toFixed(1)}%</strong></div>
        <div className="metric danger"><small>% Perda</small><strong>{lossRate.toFixed(1)}%</strong></div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>Recebiveis</h2>
          <div className="tabs">
            {tabs.map((tab) => <button key={tab.id} className={activeTab === tab.id ? "active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
          </div>
        </div>
        {message && <div className="alert ok">{message}</div>}
        <table>
          <thead><tr><th>Mes</th><th>Profissional</th><th>Sala</th><th>Valor</th><th>Pago</th><th>Saldo</th><th>Status</th><th>Acoes</th></tr></thead>
          <tbody>
            {receivables.isLoading && <tr><td colSpan={8}>Carregando...</td></tr>}
            {filteredRows.map((row) => (
              <tr key={row.id}>
                <td>{row.referenceMonth}</td>
                <td>{row.professionalName ?? row.professionalId}</td>
                <td>{row.roomName ?? row.roomId ?? "-"}</td>
                <td>{brl(row.amountDue)}</td>
                <td>{brl(row.amountPaid)}</td>
                <td>{row.status === "cancelled" ? brl(row.amountDue) : brl(Math.max(0, Number(row.amountDue) - Number(row.amountPaid ?? 0)))}</td>
                <td><span className={`badge ${row.status}`}>{row.status}</span></td>
                <td className="actions">
                  {row.status !== "paid" && row.status !== "cancelled" && <button disabled={!isGestor} onClick={() => { setSelected(row); setAmount(String(Math.max(0, Number(row.amountDue) - Number(row.amountPaid ?? 0)))); }}>Baixar</button>}
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
            {paymentRows.map((payment) => (
              <tr key={payment.id}>
                <td>{payment.receivableId}</td>
                <td>{brl(payment.amount)}</td>
                <td>{payment.paidAt?.slice(0, 10)}</td>
                <td>{payment.status}</td>
                <td className="actions">
                  {payment.status === "active" && (payment.receiptId
                    ? <span className="badge paid">Recibo emitido</span>
                    : <button disabled={!isGestor} onClick={() => issueReceipt(payment.id)}>Emitir recibo</button>)}
                  {payment.status === "active" && <button disabled={!isGestor} onClick={() => setRevertTarget(payment)}>Estornar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Recibos</h2>
        <table>
          <thead><tr><th>Numero</th><th>Pagamento</th><th>Valor</th><th>Saldo</th><th>Status</th></tr></thead>
          <tbody>
            {(receipts.data ?? []).map((receipt) => (
              <tr key={receipt.id}>
                <td>{receipt.receiptNumber}</td>
                <td>{receipt.paymentId}</td>
                <td>{brl(receipt.amountPaid)}</td>
                <td>{brl(receipt.remainingBalance)}</td>
                <td><span className={`badge ${receipt.status}`}>{receipt.status}</span></td>
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
            <label>Valor principal<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label>Multa<input type="number" step="0.01" value={lateFeeAmount} onChange={(e) => setLateFeeAmount(e.target.value)} /></label>
            <label>Juros<input type="number" step="0.01" value={interestAmount} onChange={(e) => setInterestAmount(e.target.value)} /></label>
            <label>Desconto<input type="number" step="0.01" value={discountAmount} onChange={(e) => setDiscountAmount(e.target.value)} /></label>
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
