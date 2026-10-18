import React from 'react';
import { createRoot } from 'react-dom/client';
import { UsageOverviewView } from './usage-overview-view';
import '../../src/theme.css';
import './usage-overview-standalone.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
createRoot(document.getElementById('root')!).render(<UsageOverviewView initialScenario={params.get('state') ?? 'ready'} language={params.get('lang') === 'en' ? 'en' : 'zh'}/>);
