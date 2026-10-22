import './styles.css';
import { start } from './store';

const root = document.querySelector<HTMLElement>('#app');

if (!root) {
  throw new Error('找不到 #app 掛載點');
}

start(root);
