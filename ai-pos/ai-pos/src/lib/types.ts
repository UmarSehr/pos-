export interface Product {
  id: string;
  name: string;
  category: string;
  sku: string;
  barcode: string | null;
  purchase_price: number;
  selling_price: number;
  quantity: number;
  supplier: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductStock extends Product {
  sold_qty: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  created_at: string;
}

export interface CustomerStat extends Customer {
  orders: number;
  total_spent: number;
  last_purchase: string | null;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string | null;
  product_name: string;
  category: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  line_total: number;
  unit_cost: number;
  created_at: string;
}

export interface Sale {
  id: string;
  invoice_no: number;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string | null;
  subtotal: number;
  discount_total: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  payment_method: string;
  created_at: string;
  sale_items?: SaleItem[];
}

export interface StoreSettings {
  store_name: string;
  store_address: string | null;
  store_phone: string | null;
  tax_rate: number;
  currency: string;
  receipt_footer: string | null;
}

export const DEFAULT_SETTINGS: StoreSettings = {
  store_name: 'My Store',
  store_address: '',
  store_phone: '',
  tax_rate: 18,
  currency: 'PKR',
  receipt_footer: 'Thank you for shopping with us!',
};
