export type AllowanceIssue = 'signed-out' | 'unsupported' | 'authentication' | 'not-available' | 'rate-limit'
  | 'network' | 'invalid-response' | 'identity' | 'partial' | 'expired';
export interface AccountAllowance {
  status: 'idle' | 'loading' | 'ready' | 'stale' | 'error' | 'unsupported';
  issue?: AllowanceIssue;
  plan?: { state: 'known' | 'unavailable'; family: 'coding' | 'token' | 'none'; name?: string; expiresAt?: number };
  meters: {
    kind: 'five_hour' | 'weekly' | 'subscription' | 'topup' | 'unsupported';
    remainingPercent: number | null; unlimited?: boolean; resetsAt?: number; expiresAt?: number;
  }[];
  fetchedAt?: number;
  expiresAt?: number;
  retryAt?: number;
}
