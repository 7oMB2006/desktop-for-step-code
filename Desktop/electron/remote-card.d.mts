import type { RemoteFormField } from './remote-form.mjs';

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
  form?: RemoteFormField[];
}
export interface RemoteCardButton {
  tag: 'button'; text: { tag: 'plain_text'; content: string }; value: { token: string; option: string };
}
export type RemoteCardElement =
  | { tag: 'div'; text: { tag: 'plain_text' | 'lark_md'; content: string; text_size?: string }; element_id?: string }
  | { tag: 'markdown'; content: string }
  | { tag: 'note'; elements: { tag: 'plain_text'; content: string }[] }
  | { tag: 'action'; actions: RemoteCardButton[] }
  | { tag: 'form'; name: string; elements: RemoteFormElement[] }
  | RemoteFormButton;
export type RemoteFormElement = RemoteCardElement
  | { tag: 'select_static'; name: string; required: boolean; options: { text: { tag: 'plain_text'; content: string }; value: string }[] }
  | { tag: 'input'; name: string; required: boolean; max_length: number };
export interface RemoteFormButton {
  tag: 'button'; name: string; text: { tag: 'plain_text'; content: string };
  behaviors: { type: 'callback'; value: { token: string; option: string } }[];
  form_action_type?: 'submit';
}
interface RemoteCardBase {
  config: { wide_screen_mode: boolean; update_multi: boolean };
  header?: { title: { tag: 'plain_text'; content: string } };
}
export type RemoteCardDocument = RemoteCardBase & (
  { schema?: never; elements: RemoteCardElement[] } | { schema: '2.0'; body: { elements: RemoteCardElement[] } }
);
export function remoteCardElements(card: RemoteCardDocument): RemoteCardElement[];
export function remoteCard(value: RemoteCardValue, actions?: RemoteCardButton[]): RemoteCardDocument;
export const remoteOverviewLimit: number;
export function validRemoteOverview(value: unknown): value is RemoteOverview;
