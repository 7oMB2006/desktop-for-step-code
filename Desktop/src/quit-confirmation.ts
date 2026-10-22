export interface QuitReasons {
  temporaryJobs: number;
  durableJobs: number;
  runningTasks: number;
  activeGoals: number;
  unknownCronHosts?: number;
  transitioning?: boolean;
}

export interface QuitReviewState {
  revision: number;
  request?: { id: string; reasons: QuitReasons; phase: 'review' | 'stopping' };
}

export function quitConfirmation(reasons: QuitReasons, language: 'zh' | 'en') {
  const zh = language === 'zh';
  const jobs = reasons.temporaryJobs + reasons.durableJobs;
  const cron = jobs > 0 || Boolean(reasons.unknownCronHosts);
  const kinds = Number(cron) + Number(reasons.runningTasks > 0) + Number(reasons.activeGoals > 0) + Number(Boolean(reasons.transitioning));
  const title = kinds > 1 ? zh ? '仍有任务未结束，确认退出？' : 'Tasks remain active. Quit application?'
    : cron ? reasons.unknownCronHosts
      ? zh ? '仍有定时任务需要确认，退出应用？' : 'Review scheduled tasks before quitting'
      : zh ? '仍有定时任务，确认退出？' : 'Scheduled tasks remain. Quit application?'
      : reasons.runningTasks > 0 ? zh ? '任务正在执行，确认退出？' : 'Tasks are running. Quit application?'
        : reasons.activeGoals > 0 ? zh ? 'Goal 仍在推进，确认退出？' : 'A Goal is active. Quit application?'
          : reasons.transitioning ? zh ? '会话操作尚未结束，确认退出？' : 'A session operation is in progress. Quit application?'
            : zh ? '确认退出应用？' : 'Quit application?';
  const items = [
    ...(cron ? [{
      kind: 'cron' as const,
      title: jobs > 0 ? zh ? `${jobs} 个${reasons.unknownCronHosts ? '已知' : ''}定时任务等待触发` : `${jobs}${reasons.unknownCronHosts ? ' known' : ''} scheduled ${jobs === 1 ? 'task' : 'tasks'}`
        : zh ? '定时任务状态暂不可用' : 'Scheduled-task status is unavailable',
      description: (reasons.unknownCronHosts ? zh ? '部分定时任务的数量暂时无法确认。' : 'Some scheduled-task counts cannot be verified. ' : '')
        + (zh ? '退出后将停止调度，到点不会执行。' : 'Scheduling stops when the app exits. Due tasks will not run.'),
    }] : []),
    ...(reasons.runningTasks > 0 ? [{
      kind: 'running' as const,
      title: zh ? `${reasons.runningTasks} 个任务正在执行` : `${reasons.runningTasks} running ${reasons.runningTasks === 1 ? 'task' : 'tasks'}`,
      description: zh ? '退出将中断这些任务。' : 'Quitting interrupts these tasks.',
    }] : []),
    ...(reasons.activeGoals > 0 ? [{
      kind: 'goal' as const,
      title: zh ? `${reasons.activeGoals} 个 Goal 仍在推进` : `${reasons.activeGoals} active ${reasons.activeGoals === 1 ? 'Goal' : 'Goals'}`,
      description: zh ? '退出后将不再继续推进。' : 'Progress stops when the app exits.',
    }] : []),
    ...(reasons.transitioning ? [{
      kind: 'transition' as const,
      title: zh ? '会话操作尚未结束' : 'A session operation is in progress',
      description: zh ? '退出将中断正在进行的会话操作。' : 'Quitting interrupts the ongoing session operation.',
    }] : []),
  ];
  const notes = [
    ...(reasons.temporaryJobs > 0 ? [zh
      ? `${reasons.temporaryJobs} 个临时定时任务会随退出丢失。`
      : `${reasons.temporaryJobs} temporary scheduled ${reasons.temporaryJobs === 1 ? 'task will' : 'tasks will'} be lost on exit.`] : []),
    ...(reasons.durableJobs > 0 ? [zh
      ? `${reasons.durableJobs} 个持久定时任务的记录保留，但不代表重新打开后会自动恢复调度。`
      : `Records for ${reasons.durableJobs} persistent scheduled ${reasons.durableJobs === 1 ? 'task are' : 'tasks are'} retained. Reopening the app does not guarantee scheduling resumes automatically.`] : []),
  ];
  return { title,
    items, notes, confirm: reasons.runningTasks > 0
    ? zh ? '停止任务并退出' : 'Stop tasks and quit'
    : zh ? '退出应用' : 'Quit application' };
}
