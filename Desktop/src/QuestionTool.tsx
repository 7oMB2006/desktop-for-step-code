import { createContext, useContext } from 'react';
import { Check, CircleHelp, ChevronRight } from 'lucide-react';
import type { ResponseItem } from './conversation-presentation';
import type { Questionnaire } from './questionnaire';
import { questionsFrom } from './questionnaire';
import './question-review.css';

export const QuestionContext = createContext<{
  pending: Questionnaire[]; open: (callId: string) => void;
}>({ pending: [], open: () => {} });

export function QuestionTool({ item, waitingApproval, zh }: {
  item: Extract<ResponseItem, { type: 'tool' }>; waitingApproval: boolean; zh: boolean;
}) {
  const context = useContext(QuestionContext);
  const pending = context.pending.find(q => q.callId === item.call?.id);
  const details = item.result?.details;
  const questions = pending?.questions ?? questionsFrom(details?.questions);
  const resultText = typeof item.result?.content === 'string' ? item.result.content
    : item.result?.content.filter(b => b.type === 'text').map(b => b.text).join('\n') ?? '';
  const failed = Boolean(item.result?.isError || /^Error:/u.test(resultText.trim()));
  const answered = Boolean(item.result && details?.cancelled === false && !failed);
  const cancelled = Boolean(item.result && details?.cancelled === true && !failed);
  const state = pending || waitingApproval ? 'waiting' : failed ? 'failed'
    : answered ? 'done' : cancelled ? 'stopped' : item.result ? 'failed' : 'running';
  const label = zh ? pending ? '等待回答' : waitingApproval ? '等待批准提问' : answered ? '已回答问题' : cancelled ? '提问已取消' : item.result ? '提问未完成' : '正在提问'
    : pending ? 'Awaiting answers' : waitingApproval ? 'Awaiting permission to ask' : answered ? 'Questions answered' : cancelled ? 'Questions cancelled' : item.result ? 'Questions unresolved' : 'Asking questions';
  const summary = <><CircleHelp size={14}/>{pending
    ? <button type="button" aria-label={zh ? '打开待回答问题' : 'Open pending questions'}
      onClick={() => context.open(pending.callId)}>{label}</button>
    : <span className="process-tool-label">{label}</span>}
    <span className="question-beta">Beta</span>
    {questions && <span className="question-tool-subject">{questions[0].question}</span>}
    {!pending && <ChevronRight size={13} className="disclosure-chevron"/>}</>;
  return pending ? <div className={`process-tool ${state}`} data-message-index={item.index} data-tool-state={state}>
    <div className="question-tool-summary">{summary}</div>
  </div> : <details className={`process-tool ${state}`} data-message-index={item.index} data-tool-state={state}>
    <summary className="question-tool-summary">{summary}</summary>
    <div className="process-tool-content">
      {questions?.map((question, i) => {
        const answers = Array.isArray(details?.answers) ? details.answers : [];
        const answer = answers[i];
        const value = answer && typeof answer === 'object' && 'label' in answer && typeof answer.label === 'string' ? answer.label : undefined;
        return <div className="question-record" key={i}><strong>{question.question}</strong>{value && <p>{value}</p>}</div>;
      })}
      {answered && <div className="process-tool-status"><Check size={12}/><span>{label}</span></div>}
      <details className="tool-input"><summary>{zh ? '调用参数' : 'Tool input'}</summary><pre>{JSON.stringify(item.call?.arguments ?? {}, null, 2)}</pre></details>
      {item.result && <details className="tool-output"><summary>{zh ? '原始结果' : 'Raw result'}</summary>
        <pre>{resultText}</pre></details>}
    </div>
  </details>;
}
