export function brl(value: number | null | undefined) {
  return (Number(value) || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function dateLabel(value: unknown) {
  if (!value) return "-";
  if (typeof value === "string") return value.split("T")[0].split("-").reverse().join("/");
  const maybeTimestamp = value as { toDate?: () => Date };
  if (maybeTimestamp.toDate) return maybeTimestamp.toDate().toLocaleDateString("pt-BR");
  return "-";
}
