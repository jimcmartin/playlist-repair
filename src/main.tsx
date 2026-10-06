import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LOCAL_REDIRECT_URI, redirectUriForOrigin } from './config';
import { App } from './ui/App';
import './ui/app.css';
import { boot, browserEnv } from './ui/boot';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root element to render into.');
}

// A login reply can only be used once, so it is handled here, before React
// renders, and not in an effect that StrictMode would run twice.
const env = browserEnv();
const initial = await boot(env);

createRoot(root).render(
  <StrictMode>
    <App initial={initial} redirectUri={redirectUriForOrigin(env.origin) ?? LOCAL_REDIRECT_URI} />
  </StrictMode>,
);
