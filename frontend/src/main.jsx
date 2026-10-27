import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

if (import.meta.env.DEV) {
  import('./utils/a11y').then(({ initA11yAuditor }) => initA11yAuditor());
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
