export interface RemoteListProject { ref: string; name: string }
export interface RemoteListSession { ref: string; name: string; project: string }

const line = (value: string, limit = 70) => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, limit);
const projectRef = (value = '') => /^p[1-9]\d{0,3}$/i.test(value) ? value.trim().toLowerCase() : undefined;
const sessionRef = (value: string) => /^s[1-9]\d{0,198}$/i.test(value) ? value.trim().toLowerCase() : undefined;
const listLimit = 5000;
function shortenProject(value: string, limit: number) {
  if (value.length <= limit) return value;
  if (limit < 3) return value.slice(0, limit);
  const separator = value.lastIndexOf(' · ');
  const suffix = separator >= 0 ? value.length - separator : 0;
  const tail = Math.min(limit - 2, Math.max(suffix, Math.floor((limit - 1) / 2)));
  return `${value.slice(0, limit - tail - 1)}…${value.slice(-tail)}`;
}

export function remoteSessionList(projects: RemoteListProject[], sessions: RemoteListSession[], current?: string, page = 1,
  project?: string, currentLabel?: string) {
  const groups = projects.map(project => ({ project, sessions: sessions.filter(session => session.project === project.ref) }));
  const ordered = groups.flatMap(group => group.sessions);
  const pages = Math.max(1, Math.ceil(ordered.length / 10));
  const rowsOnPage = ordered.slice((page - 1) * 10, page * 10);
  const visible = new Set(rowsOnPage);
  const scope = projectRef(project), command = `/sessions${scope ? ` ${scope}` : ''}`;
  const selected = ordered.find(session => session.ref === current);
  const selectedProject = projects.find(project => project.ref === selected?.project);
  const target = line(currentLabel ?? '', 240) || (current
    ? line(selected ? `${line(selected.ref)} · ${line(selected.name)}${selectedProject
      ? ` (${line(selectedProject.ref)} · ${line(selectedProject.name, 140)})` : ''}` : current, 240)
    : '未选择 / Not selected');
  const output = [`会话 / Sessions · ${ordered.length} · ${page} / ${pages}${scope ? ` · ${scope}` : ''}`,
    `当前 / Current: ${target}`];
  const headings: { index: number; prefix: string; name: string; suffix: string }[] = [];
  for (const group of groups) {
    const rows = group.sessions.filter(session => visible.has(session));
    if (!rows.length && (group.sessions.length || page !== 1)) continue;
    const prefix = `${line(group.project.ref)} · `, name = line(group.project.name, 140), suffix = ` (${group.sessions.length})`;
    output.push('', prefix + name + suffix);
    headings.push({ index: output.length - 1, prefix, name, suffix });
    if (!rows.length) output.push('  暂无会话 / No sessions');
    rows.forEach((session, index) => output.push(`  ${index === rows.length - 1 ? '└─' : '├─'} ${line(session.ref)} · ${line(session.name)}`
      + (session.ref === current ? ' ← 当前 / Current' : '')));
    const ref = projectRef(group.project.ref);
    const actions = ref ? [!group.sessions.length ? `/new ${ref}` : '', ref !== scope ? `/sessions ${ref}` : ''].filter(Boolean) : [];
    if (actions.length) output.push(`  ${actions.join(' · ')}`);
  }
  if (!visible.size && (ordered.length || page > pages)) output.push('', '此页没有会话 / No sessions on this page');
  if (!projects.length) output.push('', '暂无授权项目 / No authorized projects');
  const switchRef = rowsOnPage.map(session => sessionRef(session.ref)).find(Boolean);
  output.push('');
  if (switchRef) output.push(`/session ${switchRef}  切换会话 / Switch session`);
  if (page < pages) output.push(`${command} ${page + 1}  下一页 / Next page`);
  if (page > 1) output.push(`${command} ${Math.min(page - 1, pages)}  上一页 / Previous page`);
  output.push(`${command}  刷新 / Refresh`);
  const text = output.join('\n');
  if (text.length <= listLimit) return text;
  // Budget only project names; current identity, row handles and command hints stay intact.
  const fixedLength = text.length - headings.reduce((size, heading) => size + heading.name.length, 0);
  let nameLimit = 140;
  while (nameLimit > 0 && fixedLength + headings.reduce((size, heading) => size + Math.min(heading.name.length, nameLimit), 0) > listLimit)
    nameLimit--;
  for (const heading of headings)
    output[heading.index] = heading.prefix + shortenProject(heading.name, nameLimit) + heading.suffix;
  return output.join('\n');
}
