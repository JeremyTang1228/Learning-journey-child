import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

/** 手绘抖动滤镜：Design System 的 wobble，全局挂载一次供 .wobble 复用 */
function WobbleFilter() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="wobble">
        <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

// 注册 Service Worker，提供可安装 + 弱网/离线能力（规范 PWA 要求）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* 注册失败不应阻断应用 */
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WobbleFilter />
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
