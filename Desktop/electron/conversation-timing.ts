import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Message, MessageTiming, RuntimeEvent } from '../src/contracts';
import type { SessionRuntime } from './session-runtimes';

type RecordSet = Record<string, MessageTiming>;
type LiveRun = { startedAt: number; records: RecordSet };

// Desktop-owned observations, never appended to upstream messages or model context.
export class ConversationTiming {
  private live = new Map<string, LiveRun>();
  private records = new Map<string, RecordSet>();
  private writes: Promise<void> = Promise.resolve();
  constructor(private root: string, private onError: (error: unknown) => void = () => {}) {}
  private file(sessionId: string) {
    return join(this.root, `${createHash('sha256').update(sessionId).digest('hex')}.json`);
  }
  async decorate(sessionId: string, messages: Message[]) {
    if (!this.records.has(sessionId)) {
      let records: RecordSet = {};
      try {
        const value = JSON.parse(await readFile(this.file(sessionId), 'utf8'));
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const [key, timing] of Object.entries(value)) {
            const item = timing as MessageTiming;
            const valid = (time: { startedAt?: number; endedAt?: number }) => time
              && Number.isFinite(time.startedAt) && Number.isFinite(time.endedAt) && time.endedAt! >= time.startedAt!;
            if (valid(item?.run) && item.thinking && Object.values(item.thinking).every(valid)) records[key] = item;
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.onError(error);
      }
      // Live events may have arrived while reading the sidecar.
      this.records.set(sessionId, { ...records, ...this.records.get(sessionId) });
    }
    const records = this.records.get(sessionId)!;
    return messages.map(message => message.role === 'assistant' && message.timestamp !== undefined && records[String(message.timestamp)]
      ? { ...message, desktopTiming: records[String(message.timestamp)] } : message);
  }
  event(worker: SessionRuntime, event: RuntimeEvent, now = Date.now()): RuntimeEvent {
    const sessionId = worker.state?.sessionId;
    if (!sessionId) return event;
    if (event.type === 'agent_start') this.live.set(worker.id, { startedAt: now, records: {} });
    const live = this.live.get(worker.id);
    if (!live) return event;
    const records = this.records.get(sessionId) ?? {};
    this.records.set(sessionId, records);
    const closeThinking = (timing: MessageTiming, before = Infinity) => {
      for (const [key, time] of Object.entries(timing.thinking)) {
        if (Number(key) < before && time.endedAt === undefined) timing.thinking[key] = { ...time, endedAt: now };
      }
    };
    const message = event.message ? event.message.role === 'assistant' ? event.message as Message : undefined
      : worker.messages.at(-1)?.role === 'assistant' ? worker.messages.at(-1) : undefined;
    if (['message_start', 'message_update', 'message_end'].includes(event.type) && message?.timestamp !== undefined) {
      const key = String(message.timestamp);
      const previous = live.records[key];
      const timing: MessageTiming = previous
        ? { run: { ...previous.run }, thinking: { ...previous.thinking } }
        : { run: { startedAt: live.startedAt }, thinking: {} };
      const delta = event.assistantMessageEvent;
      const index = delta?.contentIndex;
      if (Number.isInteger(index) && index >= 0 && index <= 10000) {
        if (['thinking_start', 'thinking_delta', 'thinking_end'].includes(delta.type)) {
          closeThinking(timing, index);
          timing.thinking[index] ??= { startedAt: now };
          if (delta.type === 'thinking_end') timing.thinking[index] = { ...timing.thinking[index], endedAt: now };
        } else if (['text_start', 'text_delta', 'toolcall_start'].includes(delta.type)) closeThinking(timing);
      }
      // Some providers send authoritative snapshots rather than start/delta events.
      if (Array.isArray(event.message?.content)) event.message.content.forEach((block: { type: string }, part: number) => {
        if (block.type === 'thinking' && !timing.thinking[part]) timing.thinking[part] = { startedAt: now };
        if (block.type === 'text' || block.type === 'toolCall') closeThinking(timing, part);
      });
      if (event.type === 'message_end') closeThinking(timing);
      live.records[key] = records[key] = timing;
      event = { ...event, desktopTimings: { [key]: timing },
        ...(event.message ? { message: { ...event.message, desktopTiming: timing } } : {}) };
    }
    if (event.type === 'agent_end' || event.type === 'desktop_exit') {
      for (const [key, previous] of Object.entries(live.records)) {
        const timing = { run: { ...previous.run, endedAt: now }, thinking: { ...previous.thinking } };
        closeThinking(timing);
        records[key] = live.records[key] = timing;
      }
      event = { ...event, desktopTimings: { ...live.records } };
      this.live.delete(worker.id);
      const contents = JSON.stringify(records);
      this.writes = this.writes.catch(() => {}).then(async () => {
        await mkdir(this.root, { recursive: true });
        const file = this.file(sessionId);
        await writeFile(`${file}.tmp`, contents, 'utf8');
        await rename(`${file}.tmp`, file);
      });
      void this.writes.catch(this.onError);
    }
    return event;
  }
  async flush() { await this.writes; }
  async remove(sessionId: string) {
    await this.flush();
    this.records.delete(sessionId);
    await rm(this.file(sessionId), { force: true });
  }
}
