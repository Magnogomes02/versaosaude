export type UserRole = "gestor" | "visualizador" | "profissional";
export type ContractStatus = "draft" | "active" | "closed" | "cancelled";
export type BookingStatus = "active" | "conflict" | "cancelled" | "reallocated";
export type ReceivableStatus = "open" | "partial" | "paid" | "overdue" | "cancelled";
export type ReceiptStatus = "issued" | "invalidated" | "cancelled";

export interface Room {
  id: string;
  name: string;
  active?: boolean;
  serviceType?: string;
}

export interface Professional {
  id: string;
  name: string;
  fullName?: string;
  email?: string;
  phone?: string;
  active?: boolean;
  serviceType?: string;
}

export interface ContractSchedule {
  id?: string;
  contractId?: string;
  weekday: number;
  roomId: string;
  startTime: string;
  endTime: string;
}

export interface Contract {
  id: string;
  professionalId: string;
  professionalName?: string;
  startDate: string;
  endDate?: string | null;
  monthlyValue: number;
  dueDay: number;
  status: ContractStatus;
  serviceType?: string;
  schedules?: ContractSchedule[];
}

export interface Booking {
  id: string;
  contractId?: string | null;
  professionalId: string;
  roomId: string;
  startAt: unknown;
  endAt: unknown;
  status: BookingStatus;
  source?: string;
}

export interface Receivable {
  id: string;
  kind: "contract" | "single";
  contractId?: string | null;
  bookingId?: string | null;
  professionalId: string;
  roomId?: string | null;
  roomName?: string | null;
  referenceMonth: string;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  status: ReceivableStatus;
  lastRevertedAt?: unknown;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  createdAt?: unknown;
}
