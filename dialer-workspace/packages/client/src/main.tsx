import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/tokens.css';
import './styles/app.css';

/**
 * Brand is a data switch: the three platforms ship the same bundle and differ only by
 * the token set this attribute selects.
 */
const brand = new URLSearchParams(location.search).get('brand') ?? 'smartflo';
document.documentElement.setAttribute('data-brand', brand);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
