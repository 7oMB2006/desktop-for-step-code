import type { ComposerAttachment, Snapshot } from './contracts';
import type { ChatQuote } from './chat-quotes';
import type { ReadingPosition } from './session-reading';

export type ComposerOwner = { sessionId: string } | { draftId: string };
export type ComposerValue = { text: string; quotes: ChatQuote[]; attachments: ComposerAttachment[] };
export type ComposerSnapshot = { owner: ComposerOwner; revision: number; value: ComposerValue };
export type ComposerDelta = { owner: ComposerOwner; revision: number; baseRevision: number; value: Partial<ComposerValue> };
export type ComposerUpdate = ComposerSnapshot | ComposerDelta;
export type ComposerWrite = { owner: ComposerOwner; revision: number; value: Partial<ComposerValue> };
export type ComposerResult = { accepted: boolean; snapshot: ComposerUpdate };
export type ComposerReceipt = { owner: ComposerOwner; token: string; value: ComposerValue };
export type WindowPresentation = {
  position: ReadingPosition;
  disclosures: [string, { revision: string; expanded: boolean }][];
};
export type MiniChatState = { open: boolean; pinned: boolean };
export const emptyComposer = (): ComposerValue => ({ text: '', quotes: [], attachments: [] });
export const composerOwner = (value: Pick<Snapshot, 'draftId' | 'state'>): ComposerOwner | undefined =>
  value.draftId ? { draftId: value.draftId } : value.state?.sessionId ? { sessionId: value.state.sessionId } : undefined;
export const composerKey = (owner?: ComposerOwner) => owner
  ? 'sessionId' in owner ? `session:${owner.sessionId}` : `draft:${owner.draftId}` : '';

export function composerErrorText(error: unknown, language: 'zh' | 'en') {
  const message = String(error instanceof Error ? error.message : error);
  if (message.includes('COMPOSER_CONFLICT')) return language === 'zh'
    ? '另一窗口也修改了草稿，请先选择保留哪一份内容。' : 'Both windows edited this draft. Choose which version to keep.';
  if (language === 'en') return message;
  const translations: [string, string][] = [
    ['Composer changed', '草稿已在另一窗口更新，请核对后再发送。'],
    ['already been sent or cleared', '这份草稿已发送或清空，没有重复发送。'],
    ['Composer submission in progress', '草稿正在发送，请稍候。'],
    ['Draft attachments exceed', '待发送附件占用过大，请移除不再需要的附件。'],
    ['Draft cache is full', '草稿缓存已满，请保留待发内容后重启应用。'],
    ['draft submission has expired', '这份草稿的发送请求已失效，请核对当前内容。'],
    ['Composer synchronization unavailable', '草稿同步暂不可用，请保留当前内容后重试。'],
    ['This draft is being created', '正在准备首次发送，请稍候再修改项目或任务选项。'],
    ['This draft is already being created', '另一窗口正在准备这份草稿的首次发送，请稍候。'],
    ['Window reloaded', '窗口已重新载入，请核对当前内容后重试。'],
  ];
  return translations.find(([pattern]) => message.includes(pattern))?.[1] ?? message;
}

export interface WindowConversationBridge {
  readonly surface?: 'main' | 'mini' | 'plugin';
  miniChatOpen(): Promise<MiniChatState>;
  miniChatState(): Promise<MiniChatState>;
  miniChatPin(pinned: boolean): Promise<MiniChatState>;
  miniChatReturn(presentation: WindowPresentation): Promise<void>;
  miniChatMainAction(action: string, payload?: unknown): Promise<void>;
  windowPresentation(owner: ComposerOwner, value: WindowPresentation, revision: number): Promise<boolean>;
  composerRead(owner: ComposerOwner): Promise<ComposerSnapshot>;
  composerWrite(input: ComposerWrite): Promise<ComposerResult>;
  composerTake(owner: ComposerOwner, revision: number): Promise<{ snapshot: ComposerSnapshot; receipt: ComposerReceipt }>;
  composerRestore(receipt: ComposerReceipt): Promise<ComposerSnapshot>;
}
