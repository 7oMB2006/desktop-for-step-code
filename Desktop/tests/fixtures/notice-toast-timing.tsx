import { useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NoticeToast, type NoticeToastItem } from '../../src/NoticeToast';

const probe = {
  show: () => {},
  replace: (_deliverLeave = true) => {},
  deliverLeave: true,
  ready: 0,
  leaveBeforePassive: false,
  hoverBeforePassive: false,
  dismissed: 0,
};
declare global {
  interface Window { noticeTiming: typeof probe }
}
Object.assign(window, { noticeTiming: probe });

function Fixture() {
  const [notice, setNotice] = useState<NoticeToastItem | null>(null);
  probe.show = () => setNotice({ id: 1, message: 'Archived', type: 'success' });
  probe.replace = (deliverLeave = true) => {
    probe.deliverLeave = deliverLeave;
    setNotice({ id: 2, transitionFrom: 1, message: 'Restored', type: 'success' });
  };
  useLayoutEffect(() => {
    if (!notice?.transitionFrom || !probe.deliverLeave) return;
    const bubble = document.querySelector('.notice-toast')!;
    // Deliver the leave event before passive effects, while :hover still reflects
    // the previous pointer position. The component's handlers run normally.
    probe.hoverBeforePassive = bubble.matches(':hover');
    bubble.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    probe.leaveBeforePassive = true;
  }, [notice?.id]);
  useEffect(() => { probe.ready = notice?.id ?? 0; }, [notice?.id]);
  return <NoticeToast notice={notice} language="en" onDetails={() => {}}
    onDismiss={() => { probe.dismissed++; setNotice(null); }}/>;
}

const style = document.createElement('style');
style.textContent = '.notice-toast { position: fixed; left: 100px; top: 100px; width: 320px; height: 64px; display: flex; align-items: center; gap: 12px; }';
document.head.append(style);
createRoot(document.getElementById('root')!).render(<Fixture/>);
