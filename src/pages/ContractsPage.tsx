import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  callActivateContract,
  callApplyContractValueAdjustment,
  callCloseOrCancelContract,
  callCreateOrUpdateContract,
  listContracts,
  listProfessionals,
  listRooms,
} from "@/lib/api";
import { brl } from "@/lib/format";
import { useAuth } from "@/providers/AuthProvider";

const emptySchedule = { weekday: 1, roomId: "", startTime: "08:00", endTime: "09:00" };

export function ContractsPage() {
  const queryClient = useQueryClient();
  const { isGestor } = useAuth();
  const contracts = useQuery({ queryKey: ["contracts"], queryFn: listContracts });
  const professionals = useQuery({ queryKey: ["professionals"], queryFn: listProfessionals });
  const rooms = useQuery({ queryKey: ["rooms"], queryFn: listRooms });
  const [form, setForm] = useState({
    professionalId: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    monthlyValue: "",
    dueDay: "5",
    serviceType: "clinic",
    schedules: [emptySchedule],
  });
  const [message, setMessage] = useState("");
  const [closeAction, setCloseAction] = useState<{ contractId: string; mode: "closed" | "cancelled" } | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [closeForm, setCloseForm] = useState({
    effectiveDate: new Date().toISOString().slice(0, 10),
    receivableCutoffMonth: new Date().toISOString().slice(0, 7),
    closeFinancialAction: "cancel_unpaid",
    penaltyAmount: "0",
  });
  const [adjustTarget, setAdjustTarget] = useState<{ contractId: string; monthlyValue: number } | null>(null);
  const [adjustForm, setAdjustForm] = useState({
    newMonthlyValue: "",
    effectiveReferenceMonth: new Date().toISOString().slice(0, 7),
    reason: "",
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["contracts"] });
    queryClient.invalidateQueries({ queryKey: ["receivables"] });
    queryClient.invalidateQueries({ queryKey: ["bookings"] });
  };

  const save = useMutation({
    mutationFn: async () => callCreateOrUpdateContract({
      ...form,
      monthlyValue: Number(form.monthlyValue),
      dueDay: Number(form.dueDay),
      status: "draft",
      schedules: form.schedules.filter((s) => s.roomId),
    }),
    onSuccess: () => {
      setMessage("Contrato salvo como rascunho.");
      refresh();
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    await save.mutateAsync();
  }

  async function activate(contractId: string) {
    const result = await callActivateContract({ contractId });
    const data = result.data as { receivablesCreated?: number; created?: number; conflictsRegistered?: number };
    setMessage(`Contrato ativado: ${data.receivablesCreated ?? 0} recebiveis e ${data.created ?? 0} reservas geradas.`);
    refresh();
  }

  async function confirmClose() {
    if (!closeAction || !closeReason.trim()) return;
    const result = await callCloseOrCancelContract({
      ...closeAction,
      reason: closeReason.trim(),
      effectiveDate: closeForm.effectiveDate,
      cancellationBookingCutoff: closeForm.effectiveDate,
      cancellationReceivableCutoffMonth: `${closeForm.receivableCutoffMonth}-01`,
      closeFinancialAction: closeForm.closeFinancialAction,
      penaltyAmount: Number(closeForm.penaltyAmount),
    });
    const data = result.data as { cancelledBookings?: number; cancelledReceivables?: number; lossAmount?: number; penaltyReceivableId?: string | null };
    setMessage(`Operacao concluida: ${data.cancelledBookings ?? 0} reservas, ${data.cancelledReceivables ?? 0} recebiveis cancelados, perda ${brl(data.lossAmount ?? 0)}.`);
    setCloseAction(null);
    setCloseReason("");
    refresh();
  }

  async function confirmAdjustment() {
    if (!adjustTarget || !adjustForm.reason.trim()) return;
    const result = await callApplyContractValueAdjustment({
      contractId: adjustTarget.contractId,
      newMonthlyValue: Number(adjustForm.newMonthlyValue),
      effectiveReferenceMonth: `${adjustForm.effectiveReferenceMonth}-01`,
      reason: adjustForm.reason.trim(),
    });
    const data = result.data as { updated?: number };
    setMessage(`Reajuste aplicado em ${data.updated ?? 0} recebiveis futuros.`);
    setAdjustTarget(null);
    setAdjustForm({ newMonthlyValue: "", effectiveReferenceMonth: new Date().toISOString().slice(0, 7), reason: "" });
    refresh();
  }

  return (
    <div className="page-grid">
      <section className="panel">
        <div className="panel-heading">
          <h2>Contratos</h2>
          <span className="muted">Cloud Functions protegem geracao e cancelamento.</span>
        </div>
        <table>
          <thead><tr><th>Profissional</th><th>Valor</th><th>Vencimento</th><th>Status</th><th>Acoes</th></tr></thead>
          <tbody>
            {contracts.isLoading && <tr><td colSpan={5}>Carregando...</td></tr>}
            {(contracts.data ?? []).map((contract) => (
              <tr key={contract.id}>
                <td>{contract.professionalName ?? contract.professionalId}</td>
                <td>{brl(contract.monthlyValue)}</td>
                <td>Dia {contract.dueDay}</td>
                <td><span className={`badge ${contract.status}`}>{contract.status}</span></td>
                <td className="actions">
                  {contract.status !== "active" && <button onClick={() => activate(contract.id)} disabled={!isGestor}>Ativar</button>}
                  {contract.status === "active" && <button onClick={() => { setAdjustTarget({ contractId: contract.id, monthlyValue: Number(contract.monthlyValue) }); setAdjustForm({ ...adjustForm, newMonthlyValue: String(contract.monthlyValue) }); }} disabled={!isGestor}>Aplicar reajuste</button>}
                  {contract.status === "active" && <button onClick={() => setCloseAction({ contractId: contract.id, mode: "closed" })} disabled={!isGestor}>Encerrar</button>}
                  {contract.status !== "cancelled" && <button onClick={() => setCloseAction({ contractId: contract.id, mode: "cancelled" })} disabled={!isGestor}>Cancelar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>Novo contrato</h2>
        <form className="form-grid" onSubmit={submit}>
          <label>
            Profissional
            <select value={form.professionalId} onChange={(e) => setForm({ ...form, professionalId: e.target.value })} required>
              <option value="">Selecione</option>
              {(professionals.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name ?? p.fullName ?? p.id}</option>)}
            </select>
          </label>
          <label>
            Inicio
            <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
          </label>
          <label>
            Fim
            <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          </label>
          <label>
            Valor mensal
            <input type="number" step="0.01" value={form.monthlyValue} onChange={(e) => setForm({ ...form, monthlyValue: e.target.value })} required />
          </label>
          <label>
            Dia vencimento
            <input type="number" min="1" max="28" value={form.dueDay} onChange={(e) => setForm({ ...form, dueDay: e.target.value })} required />
          </label>
          <div className="schedule-editor">
            <strong>Grade</strong>
            {form.schedules.map((schedule, index) => (
              <div className="schedule-row" key={index}>
                <select value={schedule.weekday} onChange={(e) => {
                  const schedules = [...form.schedules];
                  schedules[index] = { ...schedule, weekday: Number(e.target.value) };
                  setForm({ ...form, schedules });
                }}>
                  {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"].map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}
                </select>
                <select value={schedule.roomId} onChange={(e) => {
                  const schedules = [...form.schedules];
                  schedules[index] = { ...schedule, roomId: e.target.value };
                  setForm({ ...form, schedules });
                }}>
                  <option value="">Sala</option>
                  {(rooms.data ?? []).map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
                </select>
                <input type="time" value={schedule.startTime} onChange={(e) => {
                  const schedules = [...form.schedules];
                  schedules[index] = { ...schedule, startTime: e.target.value };
                  setForm({ ...form, schedules });
                }} />
                <input type="time" value={schedule.endTime} onChange={(e) => {
                  const schedules = [...form.schedules];
                  schedules[index] = { ...schedule, endTime: e.target.value };
                  setForm({ ...form, schedules });
                }} />
              </div>
            ))}
            <button type="button" onClick={() => setForm({ ...form, schedules: [...form.schedules, emptySchedule] })}>Adicionar horario</button>
          </div>
          {message && <div className="alert ok">{message}</div>}
          {save.error && <div className="alert danger">{save.error.message}</div>}
          <button className="primary-button" disabled={!isGestor || save.isPending}>{save.isPending ? "Salvando..." : "Salvar contrato"}</button>
        </form>
      </section>

      {closeAction && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{closeAction.mode === "closed" ? "Encerrar contrato" : "Cancelar contrato"}</h2>
            <p className="muted">A operacao preserva historico financeiro e cancela reservas futuras.</p>
            <label>
              Data efetiva
              <input type="date" value={closeForm.effectiveDate} onChange={(e) => setCloseForm({ ...closeForm, effectiveDate: e.target.value })} />
            </label>
            <label>
              Cancelar recebiveis a partir de
              <input type="month" value={closeForm.receivableCutoffMonth} onChange={(e) => setCloseForm({ ...closeForm, receivableCutoffMonth: e.target.value })} />
            </label>
            <label>
              Tratamento financeiro
              <select value={closeForm.closeFinancialAction} onChange={(e) => setCloseForm({ ...closeForm, closeFinancialAction: e.target.value })}>
                <option value="cancel_unpaid">Cancelar nao pagos como perda</option>
                <option value="keep_all">Manter recebiveis em aberto</option>
              </select>
            </label>
            <label>
              Multa contratual
              <input type="number" step="0.01" value={closeForm.penaltyAmount} onChange={(e) => setCloseForm({ ...closeForm, penaltyAmount: e.target.value })} />
            </label>
            <label>
              Motivo
              <textarea rows={4} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} autoFocus />
            </label>
            <div className="actions end">
              <button type="button" onClick={() => { setCloseAction(null); setCloseReason(""); }}>Voltar</button>
              <button className="primary-button" disabled={!closeReason.trim()} onClick={confirmClose}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {adjustTarget && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Aplicar reajuste</h2>
            <p className="muted">Recebiveis pagos e cancelados nao serao alterados. Recebiveis parciais serao recalculados.</p>
            <label>
              Valor atual
              <input value={brl(adjustTarget.monthlyValue)} disabled />
            </label>
            <label>
              Novo valor
              <input type="number" step="0.01" value={adjustForm.newMonthlyValue} onChange={(e) => setAdjustForm({ ...adjustForm, newMonthlyValue: e.target.value })} />
            </label>
            <label>
              A partir da competencia
              <input type="month" value={adjustForm.effectiveReferenceMonth} onChange={(e) => setAdjustForm({ ...adjustForm, effectiveReferenceMonth: e.target.value })} />
            </label>
            <label>
              Motivo
              <textarea rows={4} value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} />
            </label>
            <div className="actions end">
              <button type="button" onClick={() => setAdjustTarget(null)}>Voltar</button>
              <button className="primary-button" disabled={!adjustForm.reason.trim() || Number(adjustForm.newMonthlyValue) <= 0} onClick={confirmAdjustment}>Confirmar reajuste</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
