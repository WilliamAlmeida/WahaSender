import crypto from 'crypto';
import { MercadoPagoConfig, PreApproval, Payment } from 'mercadopago';
import { logger } from '../logger';
import type {
  BillingProvider,
  CheckoutContext,
  CheckoutResult,
  ParsedWebhook,
} from './provider';

/**
 * Mercado Pago billing provider.
 *
 * Recurring card charges use the "Assinaturas" / PreApproval API. When no
 * access token is configured the provider runs in MOCK mode: checkout activates
 * the subscription locally so the full flow is testable without credentials.
 */
export class MercadoPagoProvider implements BillingProvider {
  readonly name = 'mercadopago';
  readonly isMock: boolean;
  private client: MercadoPagoConfig | null = null;
  private webhookSecret?: string;

  constructor(accessToken?: string, webhookSecret?: string) {
    this.isMock = !accessToken;
    this.webhookSecret = webhookSecret;
    if (accessToken) {
      this.client = new MercadoPagoConfig({ accessToken });
    } else {
      logger.warn('[Billing] MP_ACCESS_TOKEN not set — Mercado Pago running in MOCK mode');
    }
  }

  async createCheckout(ctx: CheckoutContext): Promise<CheckoutResult> {
    const externalReference = `${ctx.userId}:${ctx.plan.id}`;

    if (this.isMock || !this.client) {
      // No real provider: signal the caller to activate the subscription locally.
      return {
        checkoutUrl: `${ctx.backUrls.success}?mock=1&ref=${encodeURIComponent(externalReference)}`,
        externalId: `mock-${crypto.randomUUID()}`,
        mock: true,
      };
    }

    const preapproval = new PreApproval(this.client);
    const result = await preapproval.create({
      body: {
        reason: `WahaSender — Plano ${ctx.plan.name}`,
        external_reference: externalReference,
        payer_email: ctx.email,
        back_url: ctx.backUrls.success,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: ctx.plan.priceCents / 100,
          currency_id: ctx.plan.currency || 'BRL',
        },
        status: 'pending',
      },
    });

    const initPoint = (result as any).init_point || (result as any).sandbox_init_point;
    if (!initPoint) throw new Error('Mercado Pago did not return an init_point');
    return { checkoutUrl: initPoint, externalId: String(result.id), mock: false };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    if (this.isMock || !this.client) return;
    const preapproval = new PreApproval(this.client);
    await preapproval.update({ id: providerSubscriptionId, body: { status: 'cancelled' } });
  }

  verifySignature(headers: Record<string, any>, rawBody: Buffer | undefined): boolean {
    // When no secret is configured we cannot verify — accept (dev) but log.
    if (!this.webhookSecret) return true;
    const signature = headers['x-signature'];
    const requestId = headers['x-request-id'];
    if (!signature || typeof signature !== 'string') return false;
    // x-signature: "ts=...,v1=<hmac>"
    const parts = Object.fromEntries(
      signature.split(',').map((kv) => kv.split('=').map((s) => s.trim()) as [string, string]),
    );
    const ts = parts['ts'];
    const v1 = parts['v1'];
    if (!ts || !v1) return false;
    const dataId = (headers['__dataId'] as string) || '';
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const hmac = crypto.createHmac('sha256', this.webhookSecret).update(manifest).digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(v1));
    } catch {
      return false;
    }
  }

  async resolveWebhook(query: Record<string, any>, body: any): Promise<ParsedWebhook | null> {
    const topic = query.topic || query.type || body?.type;
    const dataId = query['data.id'] || query.id || body?.data?.id;
    if (!dataId) return null;

    if (this.isMock || !this.client) {
      return { externalId: `mock-${dataId}`, type: 'unknown' };
    }

    if (topic === 'payment') {
      const payment = new Payment(this.client);
      const info: any = await payment.get({ id: String(dataId) });
      return {
        externalId: `payment-${info.id}`,
        type: 'payment',
        status: info.status, // approved | pending | rejected | refunded
        providerPaymentId: String(info.id),
        amountCents: Math.round((info.transaction_amount || 0) * 100),
        method: info.payment_type_id, // credit_card | pix | ticket(boleto)
        externalReference: info.external_reference,
      };
    }

    if (topic === 'subscription_preapproval' || topic === 'preapproval') {
      const preapproval = new PreApproval(this.client);
      const info: any = await preapproval.get({ id: String(dataId) });
      return {
        externalId: `preapproval-${info.id}`,
        type: 'subscription',
        status: info.status, // authorized | paused | cancelled | pending
        providerSubscriptionId: String(info.id),
        externalReference: info.external_reference,
      };
    }

    return { externalId: `${topic}-${dataId}`, type: 'unknown' };
  }
}
