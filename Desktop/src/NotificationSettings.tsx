import { useState } from 'react';
import type { NotificationPreferences, Preferences } from './contracts';
import { notificationPreferences } from './notification-preferences';

export function NotificationSettings({ preferences, onChange }: {
  preferences: Preferences; onChange: (patch: Partial<NotificationPreferences>) => Promise<unknown>;
}) {
  const [pending, setPending] = useState<Partial<NotificationPreferences> | null>(null);
  const value = { ...notificationPreferences(preferences), ...pending };
  const t = (zh: string, en: string) => preferences.language === 'zh' ? zh : en;
  const options = [
    ['approvalNotifications', t('审批请求通知', 'Approval request notifications')],
    ['completionNotifications', t('任务完成通知', 'Task completion notifications')],
    ['completionSound', t('完成提示音', 'Completion sound')],
  ] as const;
  return <section aria-label={t('通知与声音', 'Notifications and sound')}>
    <h3>{t('通知与声音', 'Notifications and sound')}</h3>
    {options.map(([key, label]) => <label className="checkbox" key={key}>
      <input type="checkbox" checked={value[key]} disabled={pending !== null} onChange={event => {
        const patch = { [key]: event.target.checked };
        setPending(patch);
        void onChange(patch).catch(() => {}).finally(() => setPending(null));
      }}/>{label}
    </label>)}
  </section>;
}
