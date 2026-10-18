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
  phone?: string | null;
  username?: string | null;
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
  bankPaymentConfirmed?: boolean;
  emirate: string;
  employeeId: string;
  employee: { id: string; name: string };
  status: OrderStatus;
  remarks?: string | null;
  transferredBy?: string | null;
  resolvedAt?: string | null;
  /** Area set by the driver (overrides the one guessed from the address). */
  area?: string | null;
  /** Customer details, when the order came from a vendor booking. */
  booking?: OrderBookingDetails | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderBookingDetails {
  customerName: string;
  customerPhone: string;
  address: string;
  emirate: string;
  items?: string | null;
  notes?: string | null;
  vendorRef?: string | null;
  codAmount: number;
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

export const EMIRATES = ["DUBAI", "SHARJAH", "ABUDHABI", "AL AIN", "AJMAN", "RAS AL KHAIMAH", "FUJAIRAH", "UMM AL QUWAIN", "EXCHANGED", "OTHER"];
export const STATUSES: OrderStatus[] = ["PENDING", "DELIVERED", "TRANSFER", "CANCELLED"];
export const PAYMENTS: PaymentMode[] = ["CASH", "BANK"];

export type BookingStatus = "AWAITING_PICKUP" | "ACCEPTED" | "REJECTED";

/** A consignment booked through the Vendor Portal (or by the office for a vendor). */
export interface Booking {
  id: string;
  vendorId: string;
  vendor: { id: string; name: string; deliveryCharge?: number };
  cnNo: number;
  cnSource: "SYSTEM" | "VENDOR";
  vendorRef?: string | null;
  customerName: string;
  customerPhone: string;
  address: string;
  emirate: string;
  items?: string | null;
  codAmount: number;
  notes?: string | null;
  status: BookingStatus;
  rejectReason?: string | null;
  createdBy: "VENDOR" | "ADMIN" | "WEBSITE";
  hasPhoto?: boolean;
  orderId?: string | null;
  order?: {
    id: string;
    status: OrderStatus;
    date: string;
    resolvedAt?: string | null;
    employee: { id?: string; name: string };
  } | null;
  labelPrintedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BookingInput {
  vendorRef?: string;
  billNo?: string;
  confirmDuplicate?: boolean;
  customerName: string;
  customerPhone: string;
  address: string;
  emirate: string;
  items?: string;
  codAmount: number;
  notes?: string;
}
