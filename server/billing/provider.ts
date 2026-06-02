import { config } from '../config';
import type { Plan } from '../lib/entitlements';
import { MercadoPagoProvider } from './mercadopago';

/**
 * Billing provider abstraction. Today we ship a Mercado Pago implementation and
 * a mock provider (used when MP_ACCESS_TOKEN is absent — local/dev/test), but
 * the interface keeps the rest of the app provider-agnostic.
 */

export interface CheckoutContext {
  userId: string;
  email: string;
  plan: Plan;
  backUrls: { success: string; pending: string; failure: string };
}

export interface CheckoutResult {
  /** URL to redirect the user to in order to complete payment. */
  checkoutUrl: string;
  /** Provider-side reference (preapproval/preference id) to reconcile webhooks. */
  externalId: string | null;
  /** True when no real provider is configured and the subscription is activated locally. */
  mock: boolean;
}

export interface ParsedWebhook {
  externalId: string; // unique id used for idempotency
  type: 'payment' | 'subscription' | 'unknown';
  status?: string;
  providerSubscriptionId?: string;
  providerPaymentId?: string;
  amountCents?: number;
  method?: string;
  externalReference?: string; // our userId:planId reference
}

export interface BillingProvider {
  readonly name: string;
  readonly isMock: boolean;
  createCheckout(ctx: CheckoutContext): Promise<CheckoutResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  /** Fetches and normalizes a webhook event by its provider id/topic. */
  resolveWebhook(query: Record<string, any>, body: any): Promise<ParsedWebhook | null>;
  /** Verifies the webhook signature (returns true when no secret configured). */
  verifySignature(headers: Record<string, any>, rawBody: Buffer | undefined): boolean;
}

let cached: BillingProvider | null = null;

export function getBillingProvider(): BillingProvider {
  if (cached) return cached;
  cached = new MercadoPagoProvider(config.MP_ACCESS_TOKEN, config.MP_WEBHOOK_SECRET);
  return cached;
}
