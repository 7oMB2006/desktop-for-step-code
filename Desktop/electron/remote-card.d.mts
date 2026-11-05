export type RemoteReplyStatus = 'working' | 'completed' | 'interrupted';
export interface RemoteCardValue { title: string; text: string; reply?: RemoteReplyStatus }
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
