/** Integer satang; server-owned amounts only. */

export type Money = {
  amount: number;
  currency: "THB";
};

export type PaymentStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type CreatePaymentInput = {
  idempotencyKey: string;
  userId: string;
  orderId?: string;
  reservationId?: string;
  money: Money;
  returnUrl?: string;
};

export type PaymentResult = {
  paymentId: string;
  status: PaymentStatus;
  provider: string;
  providerRef?: string;
};

export type WebhookEvent = {
  provider: string;
  providerRef: string;
  status: PaymentStatus;
  rawType: string;
  verified: true;
};

export type PaymentAdapter = {
  readonly providerId: string;
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  parseAndVerifyWebhook?(request: {
    headers: Headers;
    body: string;
  }): Promise<WebhookEvent>;
  getPayment?(providerRef: string): Promise<PaymentResult>;
};
