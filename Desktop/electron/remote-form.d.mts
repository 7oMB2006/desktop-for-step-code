export interface RemoteFormField { text: string; options: string[]; custom: boolean }
export const submitAnswer: string;
export const cancelAnswer: string;
export const remoteAnswerLimit: number;
export function validRemoteForm(value: unknown): value is RemoteFormField[];
export function remoteFormAnswers(fields: RemoteFormField[], value: unknown): ({ custom: string; index?: never } | { index: number; custom?: never })[] | undefined;
