import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { listProfessionals, saveProfessional } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";

export function ProfessionalsPage() {
  const queryClient = useQueryClient();
  const { isGestor } = useAuth();
  const { data = [], isLoading } = useQuery({ queryKey: ["professionals"], queryFn: listProfessionals });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", serviceType: "clinic" });
  const mutation = useMutation({
    mutationFn: () => saveProfessional(form),
    onSuccess: () => {
      setForm({ name: "", email: "", phone: "", serviceType: "clinic" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["professionals"] });
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutation.mutateAsync();
  }

  return (
    <div className="page-stack">
      <section className="panel">
        <div className="panel-heading">
          <h2>Profissionais</h2>
          <button className="secondary-button" disabled={!isGestor} onClick={() => setOpen((value) => !value)}>
            Novo profissional
          </button>
        </div>
        {open && (
          <form className="inline-form" onSubmit={submit}>
            <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <input placeholder="Telefone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <select value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })}>
              <option value="clinic">Clinica</option>
              <option value="roomharmony">RoomHarmony</option>
              <option value="other">Outro servico</option>
            </select>
            <button className="primary-button" disabled={mutation.isPending}>{mutation.isPending ? "Salvando..." : "Salvar"}</button>
          </form>
        )}
        {mutation.error && <div className="alert danger">{mutation.error.message}</div>}
        <table>
          <thead><tr><th>Nome</th><th>Email</th><th>Telefone</th><th>Servico</th><th>Status</th></tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={5}>Carregando...</td></tr>}
            {data.map((p) => (
              <tr key={p.id}>
                <td>{p.name ?? p.fullName ?? "-"}</td>
                <td>{p.email ?? "-"}</td>
                <td>{p.phone ?? "-"}</td>
                <td>{p.serviceType ?? "clinic"}</td>
                <td>{p.active === false ? "Inativo" : "Ativo"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
