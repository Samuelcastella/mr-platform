export type Variant = {
  id: number;
  sku: string;
  size?: string | null;
  color?: string | null;
  price: string | number;
  currency: string;
  available: number;
};

export type Product = {
  id: number;
  name: string;
  slug: string;
  category?: string | null;
  brand?: string | null;
  status: string;
  price: string | number;
  currency: string;
  stock: number;
  variants: Variant[];
};

export type OrderResult = {
  id: number;
  orderNumber: string;
  token: string;
  status: string;
  currency: string;
  subtotalMinor: number;
  shippingTotalMinor: number;
  grandTotalMinor: number;
};

export type Subdivision = {
  code: string;
  name: string;
};

export type DeliveryOption = {
  type: "LOCAL_DELIVERY" | "COURIER";
  provider: string | null;
  shippingMinor: number | null;
  currency: string;
  etaMinDays: number | null;
  etaMaxDays: number | null;
  quoteRequired: boolean;
};

export type FulfillmentResult = {
  id: number;
  token: string;
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  type: "STORE_PICKUP" | "LOCAL_DELIVERY" | "COURIER";
  status: string;
  provider: string;
  trackingReference: string | null;
  destination: {
    department: string | null;
    municipality: string | null;
    addressLine: string | null;
    addressReference: string | null;
    recipientName: string | null;
    recipientPhone: string | null;
  };
  quote: {
    shippingMinor: number | null;
    currency: string;
    etaMinDays: number | null;
    etaMaxDays: number | null;
  };
};

export type PaymentMethod =
  | "CASH"
  | "BANK_TRANSFER"
  | "CASH_ON_DELIVERY";

export type CheckoutResult = {
  id: number;
  token: string;
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  status: string;
  paymentMethod: PaymentMethod;
  currency: string;
  amountMinor: number;
  payment: {
    id: number;
    provider: string;
    method: PaymentMethod;
    status: string;
    amountMinor: number;
    currency: string;
    externalReference: string | null;
  };
};

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | {
      ok: false;
      status: number;
      body: {
        error?: string;
        [key: string]: unknown;
      };
    };

export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  "https://catalog-api-production-cc18.up.railway.app";

const base = API_BASE.replace(/\/$/, "");

async function jsonRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(base + path, init);
    const body = (await response.json().catch(() => ({}))) as any;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        body:
          body && typeof body === "object" && !Array.isArray(body)
            ? body
            : { error: "unexpected_response" },
      };
    }

    return {
      ok: true,
      status: response.status,
      body: body as T,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      body: { error: "network_error" },
    };
  }
}

export function makeOperationKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function fetchCatalog() {
  return jsonRequest<{ data?: Product[] }>("/v1/products?status=active");
}

export async function fetchHondurasSubdivisions() {
  return jsonRequest<{
    countryCode: string;
    subdivisions: Subdivision[];
  }>("/v1/geography/countries/HN/subdivisions");
}

export async function fetchDeliveryOptions(department: string) {
  return jsonRequest<{
    department: string;
    options: DeliveryOption[];
  }>(
    "/v1/fulfillment/options?department=" +
      encodeURIComponent(department),
  );
}

export async function createAppOrder(
  input: {
    customerName: string;
    customerPhone: string;
    items: { variantId: number; quantity: number }[];
  },
  idempotencyKey: string,
) {
  return jsonRequest<{
    order: OrderResult;
    replayed?: boolean;
  }>("/v1/orders", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      channel: "APP",
      customer: {
        name: input.customerName,
        phone: input.customerPhone,
      },
      items: input.items,
    }),
  });
}

export async function createOrderFulfillment(
  order: Pick<OrderResult, "id" | "token">,
  input: {
    type: "STORE_PICKUP" | "LOCAL_DELIVERY" | "COURIER";
    department?: string | null;
    municipality?: string | null;
    addressLine?: string | null;
    addressReference?: string | null;
    recipientName?: string | null;
    recipientPhone?: string | null;
  },
  idempotencyKey: string,
) {
  return jsonRequest<{
    fulfillment: FulfillmentResult;
    replayed?: boolean;
  }>("/v1/fulfillments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      orderId: order.id,
      orderToken: order.token,
      type: input.type,
      department: input.department ?? null,
      municipality: input.municipality ?? null,
      addressLine: input.addressLine ?? null,
      addressReference: input.addressReference ?? null,
      recipientName: input.recipientName ?? null,
      recipientPhone: input.recipientPhone ?? null,
    }),
  });
}

export async function createOrderCheckout(
  order: Pick<OrderResult, "id" | "token">,
  paymentMethod: PaymentMethod,
  idempotencyKey: string,
) {
  return jsonRequest<{
    checkout: CheckoutResult;
    replayed?: boolean;
  }>("/v1/checkouts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify({
      orderId: order.id,
      orderToken: order.token,
      paymentMethod,
    }),
  });
}
