export interface PendingPluginUpdate {
  id: string;
  fingerprint: string;
}
export function inspectPluginUpdate(root: string): Promise<PendingPluginUpdate | undefined>;
export function recoverPluginUpdate(root: string, options?: {
  allowRecovery?: boolean;
  expectedJournal?: string;
}): Promise<void>;
