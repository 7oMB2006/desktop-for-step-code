import type { SummaryTask } from './contracts';
import { Check, Diamond, X } from 'lucide-react';

// Short plans get direct task anchors. Long plans retain the full list and progress bar.
export function StellarTaskRoute({ tasks, language, onReveal }: {
  tasks: readonly SummaryTask[]; language: 'zh' | 'en'; onReveal: (task: SummaryTask) => void;
}) {
  if (!tasks.length || tasks.length > 8) return null;
  const points = tasks.map((task, i) => ({
    task,
    x: tasks.length === 1 ? .5 : i / (tasks.length - 1),
    y: 20 + Math.sin(i * 1.8) * 8,
  }));
  const labels = language === 'zh'
    ? { completed: '已完成', in_progress: '进行中', pending: '待推进', failed: '已失败' }
    : { completed: 'Completed', in_progress: 'In progress', pending: 'Pending', failed: 'Failed' };
  return <div className="stellar-task-route" role="group" aria-label={language === 'zh' ? '任务路线' : 'Task route'}>
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path className="stellar-route-line" vectorEffect="non-scaling-stroke"
        d={points.map((p, i) => `${i ? 'L' : 'M'}${p.x * 100},${p.y}`).join(' ')}/>
    </svg>
    {points.map(({ task, x, y }) => <button key={task.id} type="button" data-status={task.status}
      style={{ left: `calc(${x * 100}% - ${x * 28}px)`, top: y - 14 }}
      aria-label={`${language === 'zh' ? '定位任务' : 'Locate task'}: ${task.subject} · ${labels[task.status]}`}
      data-tooltip={`${task.subject} · ${labels[task.status]}`} onClick={() => onReveal(task)}>
      <Diamond className="stellar-route-beacon" size={22} strokeWidth={1} aria-hidden="true"/>
      {task.status === 'completed' ? <Check className="stellar-route-check" size={10} aria-hidden="true"/>
        : task.status === 'failed' ? <X className="stellar-route-check" size={10} aria-hidden="true"/>
          : <span className="stellar-route-point" aria-hidden="true"/>}
    </button>)}
  </div>;
}
