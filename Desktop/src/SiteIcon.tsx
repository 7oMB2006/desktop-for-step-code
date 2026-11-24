import { useState } from 'react';
import { Globe } from 'lucide-react';

export function SiteIcon({ source, size }: { source?: string; size: number }) {
  const [failed, setFailed] = useState<string>();
  return source && source !== failed
    ? <img src={source} width={size} height={size} alt="" draggable={false} style={{ objectFit: 'contain' }} onError={() => setFailed(source)}/>
    : <Globe size={size} aria-hidden="true"/>;
}
