import './styles.css';
import { PLACEHOLDER_SNAPSHOT } from '../core';
import { renderApp } from './app';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('找不到 #app 掛載點');
}

renderApp(root, PLACEHOLDER_SNAPSHOT);
