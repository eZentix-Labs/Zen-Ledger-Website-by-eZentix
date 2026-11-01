const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:10000';

export type ErpCategory = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
};

export type ErpProduct = {
  _id: string;
  name: string;
  sku?: string;
  category?: string;
  description?: string;
  sellingPrice?: number;
  imageUrl?: string;
  status?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem('token') || localStorage.getItem('authToken');
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
  return payload as T;
}

export const erpApi = {
  categories: () => request<ErpCategory[] | {items: ErpCategory[]}>('/api/erp/categories?active=true'),
  products: () => request<ErpProduct[] | {items: ErpProduct[]}>('/api/products'),
  assignment: (salesmanId: string) => request<{categories: string[]; products: string[]; salesmanId: string}>(`/api/erp/salesmen/${salesmanId}/assignment`),
  createCategory: (input: Pick<ErpCategory, 'name'> & Partial<Pick<ErpCategory, 'description'>>) => request<ErpCategory>('/api/erp/categories', {method: 'POST', body: JSON.stringify(input)}),
};

