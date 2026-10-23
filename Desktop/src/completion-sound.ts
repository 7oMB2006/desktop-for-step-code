let sound: HTMLAudioElement | undefined;
export type TaskCompletion = { runtimeId?: string; sessionId?: string };
const listeners = new Set<(scope: TaskCompletion) => void>();

export function onTaskCompletion(listener: (scope: TaskCompletion) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function prepareCompletionSound() {
  try {
    if (!sound) {
      sound = new Audio(new URL('./assets/task-completed.wav', import.meta.url).href);
      sound.preload = 'auto';
      sound.load();
    }
  } catch { /* Audio availability must not affect event handling. */ }
}

export function playCompletionSound(scope?: TaskCompletion) {
  // Live-only delivery: reopening a panel must never replay a previous completion.
  if (scope) for (const listener of listeners) {
    try { listener(scope); } catch { /* Visual feedback cannot suppress the notification. */ }
  }
  try {
    prepareCompletionSound();
    if (!sound) return;
    sound.currentTime = 0;
    void sound.play().catch(() => {});
  } catch { /* Audio failure must never interrupt task/event handling. */ }
}
