import type { ReactNode } from 'react';
import { APP_NAME, APP_TAGLINE } from '../config';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <h1>{APP_NAME}</h1>
        <p className="tagline">{APP_TAGLINE}</p>
      </header>
      <main>{children}</main>
    </>
  );
}
