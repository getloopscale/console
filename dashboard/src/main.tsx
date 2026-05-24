import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TheoUIProvider } from '@usetheo/ui';
import App from './app';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TheoUIProvider>
      <App />
    </TheoUIProvider>
  </StrictMode>
);
