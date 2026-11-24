import './task-progress.css';

export function TaskProgressFill({ percent }: { percent: number }) {
  return <span className="task-progress-fill" style={{ width: `${percent}%` }}><span className="task-progress-current"/></span>;
}
