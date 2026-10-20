import type { ReactNode } from 'react';
import { APP_NAME, APP_TAGLINE } from '../config';
import { LogoMark } from './LogoMark';

export function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="site-header">
        <span className="logo-mark">
          <LogoMark />
        </span>
        <div>
          <h1>{APP_NAME}</h1>
          <p className="tagline">{APP_TAGLINE}</p>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
