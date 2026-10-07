export const firstGreeting = { zh: '让梦想阶跃星辰', en: 'Let dreams reach the stars' };
export const developerMottos = ['踽踽而行 步履不停'];
const common = ['来啦！', '你好呀~', '有什么新鲜事？', '想聊什么都行。', '今天从哪里开始？', '我们从这里开始。', '慢慢来，不着急。', '有个想法？', '说说看？', '想试点什么？', '换个思路看看？', '一起琢磨一下。', '先试试，再说。', '不一定要有计划。', '随便聊聊也行。'];
const morning = ['早上好！', '早呀。', '新的一天，早上好。', '早，今天从哪开始？', '睡得还好吗？', '吃早饭了吗？', '今天有什么安排？', '不着急，慢慢开始。'];
const noon = ['中午好！', '午安。', '记得吃饭呀。', '吃点好的。', '忙了一上午，歇一会儿吧。', '有什么新想法？', '下午想做点什么？'];
const afternoon = ['下午好！', '下午好，来了呀。', '今天想聊点什么？', '手头的事情还顺利吗？', '喝口水吧。', '坐久了，起来走走。', '我们接着来。', '想到什么了？'];
const evening = ['晚上好！', '晚上好，今天辛苦了。', '今天过得怎么样？', '吃晚饭了吗？', '今晚有什么想法？', '忙了一天，歇口气。', '做点自己喜欢的事吧。', '今天还有什么想聊的？'];
const night = ['夜深了，注意身体！', '少熬夜呀！', '还没睡呀。', '这么晚，还在呀。', '忙完这段，早点休息。', '别忘了休息。', '喝口水，歇一会儿。', '困了就先睡吧。', '不急，明天也可以继续。', '身体也要照顾好呀。', '晚安，或者再聊一会儿。', '夜里安静，想聊点什么？', '又是一个不眠之夜？', '灵感来了？也别太晚睡。'];
const weekend = ['周末好！', '周末有什么安排？', '今天想做点什么？', '难得周末，放松一下。', '周末也有新想法？', '做点有意思的事吧。'];

export function greetingPool(language: 'zh' | 'en', date: Date): string[] {
  const hour = date.getHours();
  if (language === 'en') return [hour < 6 || hour >= 23 ? 'Still up? Take care.' : hour < 11 ? 'Good morning!' : hour < 14 ? 'Enjoy your lunch.' : hour < 18 ? 'Good afternoon!' : 'Good evening!', 'What is on your mind?', 'Take your time.', 'Shall we try something?', 'Remember to take a break.'];
  const timed = hour < 6 || hour >= 23 ? night : hour < 11 ? morning : hour < 14 ? noon : hour < 18 ? afternoon : evening;
  return [...timed, ...common, ...(date.getDay() === 0 || date.getDay() === 6 ? weekend : [])];
}

export function nextGreeting(language: 'zh' | 'en', previous: string, seen: Set<string>, date = new Date(), random = Math.random): string {
  // Reserve a low-frequency slot for developer-authored mottos.
  if (language === 'zh' && random() < .06 && !developerMottos.includes(previous)) return developerMottos[Math.floor(random() * developerMottos.length)];
  const pool = greetingPool(language, date);
  let available = pool.filter(text => text !== previous && !seen.has(text));
  if (!available.length) { seen.clear(); available = pool.filter(text => text !== previous); }
  const text = available[Math.floor(random() * available.length)];
  seen.add(text);
  return text;
}
