export type AllowanceIssue = 'signed-out' | 'unsupported' | 'authentication' | 'not-available' | 'rate-limit'
  | 'network' | 'invalid-response' | 'identity' | 'partial' | 'expired';
export interface AccountAllowance {
  status: 'idle' | 'loading' | 'ready' | 'stale' | 'error' | 'unsupported';
  issue?: AllowanceIssue;
  source?: 'plan' | 'api';
  balance?: { amount: number; accountType: 'prepaid' | 'postpaid'; currency?: 'CNY' | 'USD' };
  quota?: { allowed: boolean; reason?: string };
  plan?: { state: 'known' | 'unavailable'; family: 'coding' | 'token' | 'none'; name?: string; expiresAt?: number };
  meters: {
    kind: 'five_hour' | 'weekly' | 'subscription' | 'topup' | 'unsupported';
    remainingPercent: number | null; unlimited?: boolean; resetsAt?: number; expiresAt?: number;
  }[];
  fetchedAt?: number;
  observedAt?: number;
  expiresAt?: number;
  retryAt?: number;
}

export function hasAccountSnapshot(value: AccountAllowance): boolean {
  return value.plan !== undefined || value.balance !== undefined;
}
