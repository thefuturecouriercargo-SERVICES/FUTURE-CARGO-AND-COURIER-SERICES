import { OrderStatus } from "@/types";

export default function StatusStamp({ status }: { status: OrderStatus }) {
  return <span className={`stamp ${status.toLowerCase()}`}>{status}</span>;
}
