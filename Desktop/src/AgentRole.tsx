import { Bot, CodeXml, FlaskConical, ScanSearch, ShieldCheck, type LucideIcon } from 'lucide-react';
import './agent-role.css';

type Role = {
  icon: LucideIcon;
  name: [string, string];
  output: [string, string];
  empty: [string, string];
};
const fallback: Role = { icon: Bot, name: ['自定义代理', 'Custom agent'],
  output: ['任务产出', 'Task output'], empty: ['尚未返回产出', 'No output returned yet'] };
const roles: Record<string, Role> = {
  general: { ...fallback, name: ['通用', 'General'] },
  explore: { icon: ScanSearch, name: ['探索', 'Explore'], output: ['探索记录', 'Exploration notes'],
    empty: ['尚未返回探索记录', 'No exploration notes returned yet'] },
  review: { icon: ShieldCheck, name: ['审查', 'Review'], output: ['审查结论', 'Review notes'],
    empty: ['尚未返回审查结论', 'No review notes returned yet'] },
  implement: { icon: CodeXml, name: ['实现', 'Implement'], output: ['实现产出', 'Implementation output'],
    empty: ['尚未返回实现产出', 'No implementation output returned yet'] },
  test: { icon: FlaskConical, name: ['测试', 'Test'], output: ['验证记录', 'Verification notes'],
    empty: ['尚未返回验证记录', 'No verification notes returned yet'] },
};
export function roleFor(agent: string) { return Object.hasOwn(roles, agent) ? roles[agent] : fallback; }

export function AgentRoleIcon({ agent, language }: { agent?: string; language: 'zh' | 'en' }) {
  const role = roleFor(agent ?? ''), Icon = role.icon;
  const label = agent ? `${role.name[language === 'zh' ? 0 : 1]} · ${agent}`
    : language === 'zh' ? '代理角色未提供' : 'Agent role not reported';
  return <span className="agent-role-icon" data-agent-role={agent || 'unknown'} role="img" aria-label={label} title={label}>
    <Icon size={15} aria-hidden="true"/>
  </span>;
}

export function AgentRoleLabel({ agent, language }: { agent: string; language: 'zh' | 'en' }) {
  const role = roleFor(agent);
  return <span className="agent-role-label"><AgentRoleIcon agent={agent} language={language}/>
    <span>{role.name[language === 'zh' ? 0 : 1]}</span><code>{agent}</code></span>;
}
