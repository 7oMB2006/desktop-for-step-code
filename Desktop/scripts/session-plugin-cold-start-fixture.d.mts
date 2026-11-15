import type { ConfigurationDescriptor } from '../electron/plugin-configuration.mjs';

export const COLD_START_PAYLOAD_FILES: number;
export const COLD_START_PLUGIN_IDS: { sdk: 'dfsc-host-example'; large: 'startup-dependency-tools' };
export const COLD_START_DESKTOP_TITLES: { sdk: string; large: string };
export interface TreeInventory { files: number; bytes: number }
export function treeInventory(directory: string): Promise<TreeInventory>;
export function createColdStartPluginFixture(profile: string, node: string,
  options?: { payloadFiles?: number }): Promise<{
    root: string;
    model: { workspace: string; requests: string[]; finish(): void; close(): Promise<void> };
    sdkLaunchLog: string; largeLaunchLog: string; historicalSessionId: string;
    descriptor: ConfigurationDescriptor; configurationRevision: string;
    inventory: {
      installed: TreeInventory; marketplace: TreeInventory; payloadFilesPerCopy: number;
      copies: number; executablePlugin: boolean; desktopPagesPerPlugin: number;
      dependencyDirectory: string; sdkMode: string; unrelatedServiceEnabled: boolean;
    };
  }>;
