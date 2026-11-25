import { useLayoutEffect } from 'react';
import { applyThemeMaterial, type ThemeMaterial } from './theme-material';
import './stellar-workspace.css';
import './stellar-chrome.css';
import './stellar-records.css';
import './stellar-decisions.css';
import './stellar-navigation.css';
import './stellar-controls.css';
import './stellar-settings.css';
import './stellar-surfaces.css';

export function useStellarMaterial(material?: ThemeMaterial) {
  useLayoutEffect(() => {
    applyThemeMaterial(material);
    return () => applyThemeMaterial();
  }, [material]);
}
