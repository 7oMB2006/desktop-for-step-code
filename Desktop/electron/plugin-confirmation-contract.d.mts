import type { PluginConfirmation, PluginConfirmationBinding } from '../src/plugin-confirmations';
export function parsePluginConfirmations(value: unknown): PluginConfirmation[];
export function validPluginConfirmationBinding(value: unknown): value is PluginConfirmationBinding;
