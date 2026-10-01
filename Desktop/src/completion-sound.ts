let sound: HTMLAudioElement | undefined;

export function playCompletionSound() {
  sound ??= new Audio(new URL('./assets/task-completed.wav', import.meta.url).href);
  sound.currentTime = 0;
  // Audio failure must never interrupt task/event handling.
  void sound.play().catch(() => {});
}
