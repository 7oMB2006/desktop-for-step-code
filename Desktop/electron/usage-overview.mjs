import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// The v0.1.5 scanner owns inventory, bounded projection, caching and lineage.
// Its private cache v1 retains provider/model/usage but never message content.
// Read only the matching complete cache and reconcile every day against the
// public result. A future schema change degrades to honest unclassified totals.
export async function scanDesktopUsage(upstream, sessions, cacheDir, now = new Date()) {
  const dates = Array.from({ length: 365 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 364 + i);
    return dateKey(d);
  });
  const roots = [sessions], cwd = sessions, scope = 'all';
  const native = await upstream.scanUsageOverview(roots, cacheDir, cwd, scope, AbortSignal.timeout(28000));
  const key = createHash('sha256').update(JSON.stringify([
    roots, cwd, scope, dates[0], dates.at(-1), Intl.DateTimeFormat().resolvedOptions().timeZone, 1,
  ])).digest('hex');
  let files;
  try {
    const path = join(cacheDir, `activity-${key}.jsonl`);
    if ((await stat(path)).size > 32 * 1024 * 1024) throw new Error('Cache limit');
    files = decodeCache(await readFile(path, 'utf8'), key);
  } catch {
    return fallback(native);
  }
  try { return projectDesktopUsage(native, files); }
  catch { return fallback(native); }
}

const dateKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const blankDay = date => ({ date, official: 0, custom: 0, unknown: 0, chats: 0,
  officialChats: 0, customChats: 0, samples: [], plan: null, api: null, usd: null });
// Reasoning/skill activity coverage does not limit the Token charts shown here.
const tokenLimits = native => native.limited.filter(reason =>
  !['Reasoning coverage is limited', 'Older sessions did not record activity'].includes(reason));
function fallback(native) {
  return { days: native.days.map(d => ({ ...blankDay(d.date), unknown: d.tokens, chats: d.chats })),
    chats: { all: native.chats, official: 0, custom: 0 }, scannedAt: Date.now(),
    limited: [...tokenLimits(native), 'detail-unavailable'] };
}
export function decodeCache(text, key) {
  const files = new Map();
  let matching = false, complete = false, count = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line), d = frame.data;
    if (frame.type === 'usage-cache-meta') {
      if (d?.version !== 1 || d.key !== key) throw new Error('Cache identity');
      matching = true;
      complete = d.complete === true;
    } else {
      if (!matching || complete || frame.type !== 'usage-cache-file' || typeof d?.path !== 'string'
        || !Array.isArray(d.entries) || (count += d.entries.length) > 25000) throw new Error('Cache schema');
      const previous = files.get(d.path);
      if (d.chunk !== (previous?.chunks ?? 0)) throw new Error('Cache chunk');
      if (previous) { previous.entries.push(...d.entries); previous.chunks++; }
      else files.set(d.path, { ...d, chunks: 1 });
    }
  }
  if (!matching || !complete) throw new Error('Incomplete cache');
  return [...files.values()];
}
const validID = id => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
function normalized(raw) {
  if (!raw || ![raw.input, raw.output, raw.cacheRead, raw.cacheWrite]
    .every(n => Number.isSafeInteger(n) && n >= 0)) return;
  const total = raw.input + raw.output + raw.cacheRead + raw.cacheWrite;
  if (!Number.isSafeInteger(total)) return;
  return { input: raw.input, output: raw.output, cached: raw.cacheRead, written: raw.cacheWrite, total };
}
function picked(entry) {
  if (entry.type === 'message' && ['assistant', 'toolResult'].includes(entry.message?.role)) return entry.message.usage;
  if (['compaction', 'branch_summary'].includes(entry.type)) return entry.usage;
  if (entry.type === 'custom' && entry.customType === 'step-auto-clm-usage') return entry.data?.usage;
}

export function projectDesktopUsage(native, files) {
  const limited = new Set(tokenLimits(native)), days = new Map(native.days.map(d => [d.date, blankDay(d.date)]));
  const meta = new Map(), parents = new Map(), origins = new Map(), resolving = new Set();
  for (const file of files) {
    const sessionId = file.header?.id, manifests = new Map();
    let owned = false;
    for (const e of file.entries) if (e.customType === 'step.usage_lineage'
      && e.data?.version === 1 && e.data.sessionId === sessionId && e.data.origins && typeof e.data.origins === 'object') {
      owned = true;
      for (const [id, origin] of Object.entries(e.data.origins))
        if (origin && validID(origin.sessionId) && typeof origin.cwd === 'string' && ['user', 'subagent'].includes(origin.role))
          manifests.set(id, origin);
    }
    meta.set(file, { cap: file.entries.find(e => e.customType === 'step.activity_capabilities'
      && e.data?.sessionId === sessionId)?.data, ids: new Set(file.entries.map(e => String(e.id))), manifests, owned });
    parents.set(file.path, file);
    for (const alias of file.aliases ?? []) parents.set(alias, file);
  }
  // Mirror native origin resolution before aggregating dimensions, then reconcile.
  const originFor = (file, id) => {
    const key = `${file.path}|${id}`;
    if (origins.has(key)) return origins.get(key);
    const m = meta.get(file), sessionId = String(file.header.id), cap = m.cap;
    let origin = { sessionId, role: cap?.sessionRole === 'subagent'
      || sessionId.startsWith('subagent-') || sessionId.startsWith('workflow-') ? 'subagent' : 'user' };
    if (resolving.has(key)) return origin;
    resolving.add(key);
    if (m.manifests.has(id)) origin = m.manifests.get(id);
    else if (!m.owned && typeof file.header.parentSession === 'string') {
      const parent = parents.get(resolve(file.header.parentSession));
      if (parent?.header && meta.get(parent)?.ids.has(id)) origin = originFor(parent, id);
    }
    resolving.delete(key); origins.set(key, origin);
    return origin;
  };
  const seen = new Set(), chats = { all: new Set(), official: new Set(), custom: new Set() };
  const dayChats = new Map(), samples = new Map();
  for (const file of files) {
    if (!validID(file.header?.id)) continue;
    const provenance = new Map(file.entries.filter(e => e.customType === 'step.usage_provenance')
      .map(e => [e.data?.usageEntryId, e.data]));
    for (let i = 0; i < file.entries.length; i++) {
      const e = file.entries[i], id = typeof e.id === 'string' ? e.id : `legacy-${i}`, origin = originFor(file, id);
      const rawTime = e.data?.startedAt ?? e.timestamp ?? e.message?.timestamp;
      const time = new Date(typeof rawTime === 'number' || typeof rawTime === 'string' ? rawTime : NaN);
      if (!Number.isFinite(time.getTime())) continue;
      const date = dateKey(time), day = days.get(date);
      if (!day) continue;
      const dc = dayChats.get(date) ?? { all: new Set(), official: new Set(), custom: new Set() };
      dayChats.set(date, dc);
      if (e.message?.role === 'user' && origin.role === 'user') {
        dc.all.add(origin.sessionId); chats.all.add(origin.sessionId);
      }
      const usage = normalized(picked(e)), unique = `${origin.sessionId}|${id}`;
      if (!usage || seen.has(unique)) continue;
      if (e.customType === 'step-auto-clm-usage' && e.data?.sessionId !== origin.sessionId) continue;
      seen.add(unique);
      const p = provenance.get(id);
      const trusted = p?.originSessionId === origin.sessionId ? p : undefined;
      const provider = e.message?.provider ?? e.data?.requestedProvider ?? trusted?.requestedProvider;
      const model = e.message?.responseModel ?? e.message?.model ?? e.data?.requestedModel ?? trusted?.requestedModel;
      const source = provider === 'step' ? 'official' : typeof provider === 'string' && provider ? 'custom' : 'unknown';
      const label = typeof model === 'string' && model.trim() ? model.slice(0, 160) : '未记录模型';
      day[source] += usage.total;
      if (source === 'unknown' && usage.total) limited.add('unknown-source');
      if (e.message?.role === 'assistant' && origin.role === 'user') {
        dc.all.add(origin.sessionId); chats.all.add(origin.sessionId);
        if (source !== 'unknown') { dc[source].add(origin.sessionId); chats[source].add(origin.sessionId); }
      }
      const sampleKey = JSON.stringify([date, source, label, time.getHours()]);
      const sample = samples.get(sampleKey) ?? { source, model: label, hour: time.getHours(), input: 0, output: 0, cached: 0, written: 0, total: 0 };
      for (const field of ['input', 'output', 'cached', 'written', 'total']) sample[field] += usage[field];
      if (!samples.has(sampleKey)) { samples.set(sampleKey, sample); day.samples.push(sample); }
    }
  }
  for (const d of native.days) {
    const day = days.get(d.date), dc = dayChats.get(d.date);
    if (day.official + day.custom + day.unknown !== d.tokens) throw new Error('Native usage mismatch');
    day.chats = d.chats; day.officialChats = dc?.official.size ?? 0; day.customChats = dc?.custom.size ?? 0;
  }
  return { days: [...days.values()], chats: { all: native.chats, official: chats.official.size, custom: chats.custom.size },
    scannedAt: Date.now(), limited: [...limited] };
}
