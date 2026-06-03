import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { listRooms, saveRoom } from "@/lib/api";
import { useAuth } from "@/providers/AuthProvider";

export function RoomsPage() {
  const queryClient = useQueryClient();
  const { isGestor } = useAuth();
  const { data = [], isLoading } = useQuery({ queryKey: ["rooms"], queryFn: listRooms });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", serviceType: "clinic" });
  const mutation = useMutation({
    mutationFn: () => saveRoom(form),
    onSuccess: () => {
      setForm({ name: "", serviceType: "clinic" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["rooms"] });
    },
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    await mutation.mutateAsync();
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Salas</h2>
        <button className="secondary-button" disabled={!isGestor} onClick={() => setOpen((value) => !value)}>
          Nova sala
        </button>
      </div>
      {open && (
        <form className="inline-form" onSubmit={submit}>
          <input placeholder="Nome da sala" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
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
        <thead><tr><th>Nome</th><th>Servico</th><th>Status</th></tr></thead>
        <tbody>
          {isLoading && <tr><td colSpan={3}>Carregando...</td></tr>}
          {data.map((room) => (
            <tr key={room.id}>
              <td>{room.name}</td>
              <td>{room.serviceType ?? "clinic"}</td>
              <td>{room.active === false ? "Inativa" : "Ativa"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
