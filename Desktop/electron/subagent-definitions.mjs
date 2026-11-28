import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const missing = error => error?.code === 'ENOENT';
const roleError = code => new Error(`subagent:${code}`);

export function createSubagentDefinitions(upstream, storageRoot, agentDir) {
  const profiles = upstream.desktopSubagentProfiles;
  const slugPattern = upstream.desktopSubagentSlug;
  const directory = join(storageRoot || '.', 'subagent-roles');
  let writes = Promise.resolve();
  const pathFor = slug => join(directory, `dfsc-personal-${slug}.md`);
  const idFor = slug => `custom:${slug}`;

  function validate({ slug, description, prompt, model, profile } = {}) {
    if (typeof slug !== 'string' || !slugPattern.test(slug) ||
        typeof description !== 'string' || !description.trim() || description.length > 240 || /[\x00-\x1f\x7f]/u.test(description) ||
        typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12_000 || prompt.includes('\0') ||
        typeof profile !== 'string' || !Object.hasOwn(profiles, profile) ||
        (model !== null && !upstream.desktopSubagentModel(model))) throw roleError('invalid');
    return { slug, description: description.trim(), prompt: prompt.trim().replace(/\r\n?/gu, '\n'), model, profile };
  }

  async function ownerDirectory() {
    if (!profiles || !slugPattern || !storageRoot || !agentDir || resolve(agentDir) !== resolve(storageRoot, 'agent')) throw roleError('unavailable');
    for (const path of [storageRoot, directory]) {
      const info = await lstat(path).catch(error => { if (!missing(error)) throw error; });
      if (info && (!info.isDirectory() || relative(path, await realpath(path)) !== '')) throw roleError('storage');
    }
  }

  async function readPersonal(slug) {
    const path = pathFor(slug);
    const info = await lstat(path).catch(error => { if (!missing(error)) throw error; });
    if (!info) return null;
    if (!info.isFile() || info.size > 64 * 1024) throw roleError('storage');
    const bytes = await readFile(path);
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const { frontmatter, body } = upstream.parseFrontmatter(content);
    if (frontmatter.name !== idFor(slug) || frontmatter['dfsc-managed'] !== true) throw roleError('conflict');
    const draft = validate({ slug, description: frontmatter.description, prompt: body,
      model: frontmatter.model ?? null, profile: frontmatter['dfsc-tool-profile'] });
    const tools = profiles[draft.profile];
    if (!Array.isArray(frontmatter.tools) || frontmatter.tools.length !== tools.length ||
        !tools.every((tool, index) => tool === frontmatter.tools[index])) throw roleError('conflict');
    return { id: idFor(slug), source: 'personal', tools, ...draft,
      revision: createHash('sha256').update(bytes).digest('hex') };
  }

  async function catalog() {
    await ownerDirectory();
    const { agents } = await upstream.discoverStepAgents(storageRoot, { agentDir, scope: 'user', desktopStorageRoot: storageRoot });
    const definitions = await Promise.all(agents.map(async role => {
      if (role.source === 'personal') return readPersonal(role.name.slice(7)).catch(() => null);
      if (role.source !== 'builtin' && role.source !== 'user') return null;
      return { id: role.name, source: role.source === 'user' ? 'file' : 'builtin',
        description: role.description, prompt: role.systemPrompt, tools: role.tools ?? null, model: role.model ?? null };
    }));
    return definitions.filter(Boolean);
  }

  function mutate(input, remove) {
    const pending = writes.then(async () => {
      await ownerDirectory();
      if (!input || typeof input.slug !== 'string' || !slugPattern.test(input.slug) ||
          (input.revision !== null && (typeof input.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(input.revision))))
        throw roleError('invalid');
      const previous = await readPersonal(input.slug);
      if ((previous?.revision ?? null) !== input.revision || (remove && !previous)) throw roleError('conflict');
      const target = pathFor(input.slug);
      if (remove) {
        await unlink(target);
        return null;
      }
      const draft = validate(input);
      const scalars = { name: idFor(draft.slug), description: draft.description, tools: profiles[draft.profile],
        'dfsc-managed': true, 'dfsc-tool-profile': draft.profile, ...(draft.model ? { model: draft.model } : {}) };
      const source = `---\n${Object.entries(scalars).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n')}\n---\n${draft.prompt}\n`;
      await mkdir(directory, { recursive: true });
      const temporary = join(directory, `.dfsc-role-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        await rename(temporary, target);
      } finally {
        await unlink(temporary).catch(error => { if (!missing(error)) throw error; });
      }
      return readPersonal(draft.slug);
    });
    writes = pending.then(() => {}, () => {});
    return pending;
  }

  return { list: () => writes.then(catalog), save: input => mutate(input, false), remove: input => mutate(input, true) };
}
