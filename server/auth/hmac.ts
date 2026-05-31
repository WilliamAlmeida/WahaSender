import crypto from 'crypto';

/**
 * Constant-time HMAC verification for webhooks.
 *   - Algorithm fixed at sha256.
 *   - Returns false on any error (including malformed inputs).
 */
export function verifyHmacSignature(payload: Buffer | string, secret: string, providedHex: string): boolean {
  if (!secret || !providedHex) return false;
  try {
    const provided = Buffer.from(providedHex.replace(/^sha256=/i, ''), 'hex');
    const computed = crypto.createHmac('sha256', secret).update(payload).digest();
    if (provided.length !== computed.length) return false;
    return crypto.timingSafeEqual(provided, computed);
  } catch {
    return false;
  }
}
