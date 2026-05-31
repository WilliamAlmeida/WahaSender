import { config } from '../config';

export interface PasswordPolicyError {
  ok: false;
  reason: string;
}
export interface PasswordPolicyOk {
  ok: true;
}

/**
 * Validates a candidate password against the configured policy.
 *   PASSWORD_MIN_LENGTH (default 10)
 *   PASSWORD_REQUIRE_COMPLEXITY=true (default) → lowercase + uppercase + digit OR symbol
 */
export function validatePassword(password: string): PasswordPolicyOk | PasswordPolicyError {
  if (typeof password !== 'string') return { ok: false, reason: 'Password must be a string' };
  if (password.length < config.PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${config.PASSWORD_MIN_LENGTH} chars` };
  }
  if (password.length > 256) {
    return { ok: false, reason: 'Password too long' };
  }
  if (config.PASSWORD_REQUIRE_COMPLEXITY) {
    const hasLower = /[a-z]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasDigit = /\d/.test(password);
    const hasSymbol = /[^A-Za-z0-9]/.test(password);
    const classes = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
    if (classes < 3) {
      return {
        ok: false,
        reason: 'Password must include at least 3 of: lowercase, uppercase, digit, symbol',
      };
    }
  }
  return { ok: true };
}
