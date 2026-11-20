export type Role = 'admin' | 'staff';
export type TableType = 'pool' | 'snooker' | 'carom' | 'ps5' | 'simulator';
export const TYPE_LABELS: Record<TableType, string> = {
  pool: 'Pool table', snooker: 'Snooker table', carom: 'Carom table', ps5: 'PS5 bay', simulator: 'Racing simulator',
};

export type PaymentMethod = 'cash' | 'card' | 'upi' | 'account';

export interface User {
  id: number;
  name: string;
  username: string;
  role: Role;
  active: boolean;
}

export interface Settings {
  business_name: string;
  currency: string;
  round_to_minutes: number;
  min_minutes: number;
  address: string;
  phone: string;
}

export interface Session {
  id: number;
  table_id: number;
  member_id: number | null;
  customer_name: string | null;
  players: number;
  start_ts: number;
  end_ts: number | null;
  billed_minutes: number | null;
  rate_per_hour: number;
  amount: number | null;
  discount: number;
  total: number | null;
  payment_method: PaymentMethod | null;
  period: string | null;
  notes: string | null;
  table_name?: string;
  member_name?: string | null;
}

export interface PoolTable {
  id: number;
  name: string;
  type: TableType;
  rate_per_hour: number;
  sort_order: number;
  active: boolean;
}

export interface FloorTable extends PoolTable {
  session: Session | null;
}

export interface Floor {
  server_time: number;
  settings: Settings;
  tables: FloorTable[];
  today: { sessions: number; revenue: number; minutes: number };
}

export interface Member {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  created_at: number;
  charges: number;
  payments: number;
  balance: number;
}

export interface LedgerEntry {
  type: 'charge' | 'payment';
  ref: number;
  ts: number;
  amount: number;
  description: string;
  balance: number;
}

export interface Expense {
  id: number;
  ts: number;
  period: string;
  category: string;
  amount: number;
  note: string | null;
}

export interface MonthReport {
  period: string;
  closed: boolean;
  closed_at: number | null;
  can_close: boolean;
  sessions_count: number;
  minutes: number;
  gross: number;
  discounts: number;
  revenue: number;
  by_method: Record<string, number>;
  account_payments: number;
  collected: number;
  expenses_total: number;
  expenses_by_category: Record<string, number>;
  expenses: Expense[];
  net: number;
  by_table: { table_id: number; name: string; sessions: number; minutes: number; revenue: number }[];
  daily: number[];
  outstanding: { id: number; name: string; phone: string | null; charges: number; payments: number; balance: number }[];
}

export interface Closing {
  period: string;
  revenue: number;
  expenses: number;
  net: number;
  sessions_count: number;
  minutes: number;
  closed_at: number;
  closed_by: string | null;
}

export interface Overview {
  month: MonthReport;
  trend: { period: string; revenue: number; expenses: number }[];
  running: number;
  members: number;
  outstanding_total: number;
  open_months: string[];
}
