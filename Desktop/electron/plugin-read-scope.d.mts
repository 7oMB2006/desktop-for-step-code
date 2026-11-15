import type { PluginReferenceSnapshot } from './plugin-library.mjs';
declare const readScope: unique symbol;
export interface PackageReadScope { readonly [readScope]: true }
export function verifyPackage(descriptor: PluginReferenceSnapshot['descriptor'], scope?: PackageReadScope): Promise<void>;
export function withVerifiedPackage<T>(descriptor: PluginReferenceSnapshot['descriptor'],
  action: (scope: PackageReadScope) => Promise<T>): Promise<T>;
