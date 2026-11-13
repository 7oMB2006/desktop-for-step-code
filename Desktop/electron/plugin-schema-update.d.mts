import type { PluginConfigurationSchema } from '../src/capabilities';
import type { PluginUpdateCompatibility } from '../src/plugin-update';

interface SnapshotContext {
  saved: {
    version: number; instance: string; id: string; schemaHash: string; revision: string;
    values: Record<string, unknown>; secrets: Record<string, unknown>;
  };
  receipt: { instance: string; id: string };
  schema: PluginConfigurationSchema;
  committed: boolean;
}
export function parseConfigurationJson(bytes: Buffer): unknown;
export function strictConfigurationSchema(raw: unknown): PluginConfigurationSchema;
export function compareConfigurationSchemas(previous: unknown, next: unknown): PluginUpdateCompatibility;
export function validateConfigurationSnapshot(context: SnapshotContext, nextSchema: PluginConfigurationSchema): void;
export function migrateConfigurationSnapshot(context: SnapshotContext, nextSchemaHash: string, nextSchema: PluginConfigurationSchema): SnapshotContext['saved'];
