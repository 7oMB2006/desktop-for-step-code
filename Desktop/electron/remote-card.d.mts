export type RemoteReplyStatus = 'working' | 'completed' | 'interrupted';
export interface RemoteOverview {
  language: 'zh' | 'en'; current?: string; total: number;
  rows: { ref: string; name: string; status: string; queue: number; attention: boolean }[];
}
export interface RemoteCardValue {
  title: string; text: string; reply?: RemoteReplyStatus;
  progress?: string; truncated?: boolean; detail?: string;
  status?: 'handled' | 'expired' | 'unavailable';
  overview?: RemoteOverview;
}
export interface RemoteCardButton {
  tag: 'button'; text: { tag: 'plain_text'; content: string }; value: { token: string; option: string };
}
export type RemoteCardElement =
  | { tag: 'div'; text: { tag: 'plain_text' | 'lark_md'; content: string } }
  | { tag: 'note'; elements: { tag: 'plain_text'; content: string }[] }
  | { tag: 'action'; actions: RemoteCardButton[] };
export interface RemoteCardDocument {
  config: { wide_screen_mode: boolean; update_multi: boolean };
  header?: { title: { tag: 'plain_text'; content: string } };
  elements: RemoteCardElement[];
}
export function remoteCard(value: RemoteCardValue, actions?: RemoteCardButton[]): RemoteCardDocument;
export const remoteOverviewLimit: number;
export function validRemoteOverview(value: unknown): value is RemoteOverview;
