export type Role = "SUPER_ADMIN" | "DRIVER" | "MANAGER";
export type OrderStatus = "PENDING" | "DELIVERED" | "TRANSFER" | "CANCELLED";
export type PaymentMode = "CASH" | "BANK";

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email?: string | null;
  role: Role;
  phone?: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  deliveryCharge: number;
  active: boolean;
}

export interface Employee {
  id: string;
  name: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  active: boolean;
  baseSalary: number;
  role?: "DRIVER" | "MANAGER" | "SUPER_ADMIN";
  isAgent?: boolean;
}

export interface Order {
  id: string;
  date: string;
  slNo: number;
  cnNo: number;
  vendorId: string;
  vendor: Vendor;
  brandName: string;
  deliveryCharge: number;
  total: number;
  payment: PaymentMode;
  emirate: string;
  employeeId: string;
  employee: { id: string; name: string };
  status: OrderStatus;
  remarks?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Summary {
  totalOrders: number;
  delivered: number;
  pending: number;
  transferred: number;
  cancelled: number;
  totalSales: number;
  totalDeliveryCharge: number;
  cashCollected: number;
  bankCollected: number;
}

export interface CashClosing {
  id: string;
  employeeId: string;
  employee: { id: string; name: string };
  date: string;
  totalDelivered: number;
  totalDeliveryCharge: number;
  cashPayments: number;
  onlinePayments: number;
  expenses: number;
  expenseRemarks?: string | null;
  balanceCash: number;
  status: "SUBMITTED" | "REVIEWED";
  submittedAt: string;
}

export const EMIRATES = ["DUBAI", "SHARJAH", "ABUDHABI", "AJMAN", "RAS AL KHAIMAH", "FUJAIRAH", "UMM AL QUWAIN", "EXCHANGED", "OTHER"];
export const STATUSES: OrderStatus[] = ["PENDING", "DELIVERED", "TRANSFER", "CANCELLED"];
export const PAYMENTS: PaymentMode[] = ["CASH", "BANK"];
