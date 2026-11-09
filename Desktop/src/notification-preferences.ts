import type { NotificationPreferences } from './contracts';

export function notificationPreferences(value: Partial<NotificationPreferences>): NotificationPreferences {
  return {
    approvalNotifications: typeof value.approvalNotifications === 'boolean' ? value.approvalNotifications : true,
    completionNotifications: value.completionNotifications === true,
    completionSound: value.completionSound === true,
  };
}

export function notificationPreferencePatch(value: Record<string, unknown>): Partial<NotificationPreferences> {
  const patch: Partial<NotificationPreferences> = {};
  for (const key of ['approvalNotifications', 'completionNotifications', 'completionSound'] as const) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== 'boolean') throw new Error('Invalid notification preference');
    patch[key] = value[key];
  }
  return patch;
}
