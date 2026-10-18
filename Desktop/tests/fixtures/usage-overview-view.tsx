import { useCallback, useRef, useState } from 'react';
import { SunMoon } from 'lucide-react';
import { AppMenu } from '../../src/AppMenu';
import { DisclosureChevron } from '../../src/DisclosureChevron';
import { UsageOverviewView as View } from '../../src/UsageOverviewView';
import { emptyUsageOverview, type UsageSample } from '../../src/usage-overview';

const sample = emptyUsageOverview();
function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  let assigned = 0, cumulative = 0;
  return weights.map(weight => {
    cumulative += weight;
    const target = Math.floor(total * cumulative / sum), value = target - assigned;
    assigned = target;
    return value;
  });
}
for (const [i, day] of sample.days.entries()) {
  const active = (i * 17 + 13) % 23 > 4;
  day.official = active ? Math.round((.25 + ((i * 37) % 101) / 35) * 1e6) : 0;
  day.custom = active && i % 3 ? Math.round((.12 + ((i * 19) % 47) / 42) * 1e6) : 0;
  day.chats = active ? 2 + i % 9 : 0; day.officialChats = day.chats; day.customChats = day.custom ? 1 : 0;
  day.plan = day.official * .00000058; day.api = day.official * .00000021;
  for (const source of ['official', 'custom'] as const) {
    const names = source === 'official' ? ['step-3.7-flash', 'step-3.5-flash'] : ['第三方模型 A', '第三方模型 B'];
    allocate(day[source], [64, 36]).forEach((total, index) => {
      allocate(total, Array.from({ length: 24 }, (_, hour) => hour < 7 || hour === 12 || hour > 22 ? 0 : 1 + (hour * 7 + i + index * 11) % 19))
        .forEach((total, hour) => {
          const [input, output, cached] = allocate(total, [30 + hour % 5, 8 + hour % 3, 62 - hour % 5 - hour % 3]);
          const value: UsageSample = { source, model: names[index], hour, total, input, output, cached, written: 0 };
          day.samples.push(value);
        });
    });
  }
}
sample.scannedAt = Date.now(); sample.chats = { all: 112, official: 90, custom: 37 };
const scenarios = [{ id: 'ready', label: '正常' }, { id: 'empty', label: '无记录' },
  { id: 'loading', label: '加载中' }, { id: 'error', label: '扫描失败' }, { id: 'partial', label: '覆盖不完整' }];
export function UsageOverviewView({ embedded = false, initialScenario = 'ready' }: { embedded?: boolean; initialScenario?: string }) {
  const [scenario, setScenario] = useState(initialScenario);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const overview = scenario === 'empty' ? { ...emptyUsageOverview(), scannedAt: Date.now() }
    : { ...sample, limited: scenario === 'partial' ? ['fixture'] : [] };
  return <View embedded={embedded} overview={overview} pending={scenario === 'loading'} error={scenario === 'error'}
    onRefresh={() => setScenario('ready')} controls={<>
      <span>示例数据</span><button className="usage-scenario-trigger" ref={anchor} aria-label="预览状态" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(value => !value)}><span>{scenarios.find(s => s.id === scenario)?.label}</span><DisclosureChevron/></button>
      <AppMenu anchor={anchor} open={open} label="预览状态" items={scenarios} selected={scenario} maxVisibleItems={5} onSelect={setScenario} onClose={close}/>
      {!embedded && <button className="icon-button" aria-label="切换主题" onClick={() => {
        document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      }}><SunMoon size={17}/></button>}
    </>}/>;
}
