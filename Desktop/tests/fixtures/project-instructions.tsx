import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RotateCcw } from 'lucide-react';
import { applyTheme, themes } from '../../src/theme';
import type { ThemeId } from '../../src/theme';
import type { ProjectInstructionsStatus } from '../../src/project-instructions';
import '../../src/style.css';
import '../../src/theme.css';
import './project-instructions.css';

function Preview() {
  const params = new URLSearchParams(location.search);
  const [mode, setMode] = useState<ProjectInstructionsStatus['mode']>('review');
  const [language, setLanguage] = useState<'zh' | 'en'>(params.get('lang') === 'en' ? 'en' : 'zh');
  const [theme, setTheme] = useState<ThemeId>(() => themes.find(item => item.id === params.get('theme'))?.id ?? 'wine');
  const [revision, setRevision] = useState(0);
  useEffect(() => { applyTheme(theme, false); }, [theme]);
  const query = new URLSearchParams({ mode, lang: language, theme, revision: String(revision) });
  return <div className="rules-preview">
    <header className="rules-preview-toolbar" aria-label="预览场景">
      <span>示例数据</span>
      <select aria-label="项目状态" value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
        <option value="create">没有 AGENTS.md</option><option value="review">已有 AGENTS.md</option>
        <option value="unavailable">读取失败</option><option value="choose-project">未选择项目</option>
      </select>
      <select aria-label="主题" value={theme} onChange={event => setTheme(event.target.value as ThemeId)}>
        {themes.map(item => <option key={item.id} value={item.id}>{item.name[language === 'zh' ? 0 : 1]}</option>)}
      </select>
      <select aria-label="语言" value={language} onChange={event => setLanguage(event.target.value as typeof language)}>
        <option value="zh">中文</option><option value="en">English</option>
      </select>
      <button className="icon-button" title="重置" aria-label="重置" onClick={() => setRevision(value => value + 1)}><RotateCcw size={16}/></button>
    </header>
    <iframe key={query.toString()} title="Desktop 原版界面"
      src={`./project-instructions-native.html?${query}`}/>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Preview/>);
