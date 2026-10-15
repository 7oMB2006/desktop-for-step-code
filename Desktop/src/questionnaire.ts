import type { UIRequest } from './contracts';

export const QUESTION_TITLE = 'Desktop clarification\n';
export interface Question {
  id: string; label: string; question: string; reason?: string;
  options: { label: string; value: string; description?: string }[]; allowFreeform: boolean;
}
export interface Questionnaire { version: 1; callId: string; questions: Question[] }
export interface QuestionAnswer { id: string; value: string; wasCustom: boolean }
export interface QuestionDraft { page: number; answers: (QuestionAnswer | undefined)[]; custom: string[] }
const record = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === 'object' && !Array.isArray(v));

export function questionsFrom(value: unknown): Question[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 12) return;
  if (!value.every(q => record(q) && typeof q.id === 'string' && q.id && typeof q.label === 'string'
    && typeof q.question === 'string' && q.question.trim() && (q.reason === undefined || typeof q.reason === 'string')
    && typeof q.allowFreeform === 'boolean' && Array.isArray(q.options) && q.options.length <= 8
    && (q.options.length || q.allowFreeform) && q.options.every(o => record(o) && typeof o.label === 'string'
      && typeof o.value === 'string' && o.label.trim() && o.value.trim()
      && (o.description === undefined || typeof o.description === 'string')))) return;
  return value as Question[];
}

export function questionnaire(request?: UIRequest): Questionnaire | undefined {
  if (request?.method !== 'input' || !request.title?.startsWith(QUESTION_TITLE)) return;
  try {
    const value: unknown = JSON.parse(request.title.slice(QUESTION_TITLE.length));
    if (!record(value) || value.version !== 1 || typeof value.callId !== 'string' || !value.callId) return;
    const questions = questionsFrom(value.questions);
    if (questions) return { version: 1, callId: value.callId, questions };
  } catch {}
}

export function validAnswer(q: Question, answer?: QuestionAnswer): boolean {
  return Boolean(answer && answer.id === q.id && typeof answer.value === 'string'
    && typeof answer.wasCustom === 'boolean' && (answer.wasCustom
      ? q.allowFreeform && answer.value.trim()
      : q.options.some(option => option.value === answer.value)));
}

export function serializeAnswers(q: Questionnaire, value: unknown): string {
  if (!Array.isArray(value) || value.length !== q.questions.length
    || !q.questions.every((question, i) => record(value[i]) && validAnswer(question, value[i] as unknown as QuestionAnswer)))
    throw new Error('Incomplete or invalid clarification answers');
  return JSON.stringify(value.map((answer: QuestionAnswer) =>
    ({ id: answer.id, value: answer.wasCustom ? answer.value.trim() : answer.value, wasCustom: answer.wasCustom })));
}
