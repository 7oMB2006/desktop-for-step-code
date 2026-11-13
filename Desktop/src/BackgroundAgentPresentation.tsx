import { useState } from 'react';
import { FileSearch } from 'lucide-react';
import { AgentRoleLabel, roleFor } from './AgentRole';
export { AgentRoleLabel } from './AgentRole';
import { BackgroundAgentStatusIcon, type BackgroundAgentPresentation, type BackgroundAgentStepProps } from './BackgroundAgentsView';
import { DisclosureChevron } from './DisclosureChevron';
import { Text } from './ConversationMessages';
import { toolPresentation } from './conversation-presentation';
import { useAnimatedDisclosure } from './useAnimatedDisclosure';
import './background-agent-roles.css';

function RuntimeDetails({ step, language }: Pick<BackgroundAgentStepProps, 'step' | 'language'>) {
  const [expanded, setExpanded] = useState(false);
  const { details, body } = useAnimatedDisclosure(expanded);
  const zh = language === 'zh';
  const format = (value?: number) => value === undefined ? (zh ? '未返回' : 'Not reported') : value.toLocaleString(zh ? 'zh-CN' : 'en-US');
  return <details ref={details} className="agent-role-runtime" data-expanded={expanded}>
    <summary aria-expanded={expanded} onClick={event => { event.preventDefault(); setExpanded(value => !value); }}>
      <span>{zh ? '运行信息' : 'Runtime details'}</span>
      <span className="agent-role-model">{step.model || (zh ? '模型未返回' : 'Model not reported')}</span>
      <span className="agent-role-disclosure"><DisclosureChevron/></span>
    </summary>
    <div ref={body} inert={!expanded} aria-hidden={!expanded}><dl className="background-agent-metrics">
      <div><dt>{zh ? '模型' : 'Model'}</dt><dd>{step.model || format()}</dd></div>
      <div><dt>{zh ? '轮次' : 'Turns'}</dt><dd>{format(step.usage.turns)}</dd></div>
      <div><dt>{zh ? '输入 Token' : 'Input tokens'}</dt><dd>{format(step.usage.input)}</dd></div>
      <div><dt>{zh ? '输出 Token' : 'Output tokens'}</dt><dd>{format(step.usage.output)}</dd></div>
      <div><dt>{zh ? '缓存读取' : 'Cache read'}</dt><dd>{format(step.usage.cacheRead)}</dd></div>
      <div><dt>{zh ? '缓存写入' : 'Cache write'}</dt><dd>{format(step.usage.cacheWrite)}</dd></div>
    </dl></div>
  </details>;
}

function RoleStep({ step, live, language, showIdentity = false, openImage, onError }: BackgroundAgentStepProps) {
  const zh = language === 'zh', role = roleFor(step.agent);
  const activeTool = step.activeTool && step.status === 'running'
    ? toolPresentation(step.activeTool, undefined, live, language).label || step.activeTool : undefined;
  return <section className="background-agent-step agent-role-step" data-agent-role={step.agent}
    aria-label={`${step.agent} ${step.index + 1}`}>
    {showIdentity && <><div className="background-agent-step-head">
      <BackgroundAgentStatusIcon status={!live && ['running', 'queued'].includes(step.status) ? 'unknown' : step.status} language={language}/>
      <strong><AgentRoleLabel agent={step.agent} language={language}/></strong>
      <span>{zh ? `第 ${step.index + 1} 步` : `Step ${step.index + 1}`}</span>
    </div><p className="background-agent-task">{step.task || (zh ? '无任务描述' : 'No task description')}</p></>}
    {step.status === 'queued' && <p className="agent-role-wait">{zh ? '等待执行' : 'Waiting to start'}</p>}
    {activeTool && <p className="agent-role-current"><FileSearch size={14}/>
      <span>{live ? zh ? '当前动作' : 'Current action' : zh ? '上次动作' : 'Last action'}</span><strong>{activeTool}</strong></p>}
    {step.error && <p className="background-agent-error" role="status">{step.error}</p>}
    <div className="agent-role-output-head"><h4>{role.output[zh ? 0 : 1]}</h4>
      {step.status === 'running' && <small>{zh ? '输出片段' : 'Output excerpt'}</small>}</div>
    {step.output ? <div className="background-agent-output agent-role-output lane-text">
      <Text text={step.output} language={language} openImage={openImage} onError={onError}/>
    </div> : <p className="agent-role-empty">{role.empty[zh ? 0 : 1]}</p>}
    {(step.outputTruncated || step.redacted > 0) && <p className="background-agent-source">
      {step.outputTruncated && <span>{zh ? '仅显示末尾片段' : 'Available tail only'}</span>}
      {step.redacted > 0 && <span>{zh ? `已隐去 ${step.redacted} 行疑似凭据内容` : `${step.redacted} credential-like lines hidden`}</span>}
    </p>}
    <RuntimeDetails step={step} language={language}/>
  </section>;
}

export const backgroundAgentPresentation: BackgroundAgentPresentation = {
  label: (agent, language) => <AgentRoleLabel agent={agent} language={language}/>,
  Step: RoleStep,
};
