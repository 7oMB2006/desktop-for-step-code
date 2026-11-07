import { sessionSearchParts } from './session-search';

export function SessionSearchText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return text;
  return sessionSearchParts(text, query).map((part, index) => part.match
    ? <mark className="session-search-match" key={index}>{part.text}</mark>
    : part.text);
}
