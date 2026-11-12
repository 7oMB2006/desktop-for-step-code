import { parseMarkdown } from './markdown-parser';

self.onmessage = (event: MessageEvent<string[]>) => {
  self.postMessage(event.data.map(text => [text, parseMarkdown(text)]));
};
