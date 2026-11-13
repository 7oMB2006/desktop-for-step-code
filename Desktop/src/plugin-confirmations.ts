export type PluginConfirmationAction = 'external.delegate' | 'external.policy';
export interface PluginConfirmation {
  id: string;
  version: string;
  action: PluginConfirmationAction;
  policy: 'always' | 'remember';
  title: string;
  message: string;
  confirmLabel: string;
}
export interface PluginConfirmationBinding { id: string; installation: string }
export interface PluginConfirmationSource {
  binding: PluginConfirmationBinding;
  name: string;
  revision: string;
  confirmations: PluginConfirmation[];
}
