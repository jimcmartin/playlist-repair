import { useState } from 'react';
import { LOCAL_REDIRECT_URI } from '../config';
import { beginLogin, logout, saveClientId } from '../spotify/auth';
import { browserEnv, type View } from './boot';
import { ConnectedScreen } from './ConnectedScreen';
import { ConnectScreen } from './ConnectScreen';
import { Layout } from './Layout';
import { describeError } from './messages';
import { SetupScreen } from './SetupScreen';

interface Props {
  initial: View;
  /** The redirect URI for the address the app is served from. */
  redirectUri: string;
}

export function App({ initial, redirectUri }: Props) {
  const [view, setView] = useState(initial);

  function handleSave(clientId: string) {
    saveClientId(browserEnv().local, clientId);
    setView({ screen: 'connect', clientId });
  }

  async function handleLogin(clientId: string) {
    try {
      window.location.assign(await beginLogin(browserEnv(), clientId, redirectUri));
    } catch (error) {
      setView({ screen: 'connect', clientId, error: describeError(error) });
    }
  }

  function handleForget(loggedOut: boolean) {
    const env = browserEnv();
    logout(env.session, env.local);
    setView({ screen: 'setup', loggedOut });
  }

  return <Layout>{renderScreen()}</Layout>;

  function renderScreen() {
    switch (view.screen) {
      case 'wrong-address':
        return (
          <>
            <h2>Wrong address</h2>
            <p role="alert" className="error">
              Playlist Repair cannot connect to Spotify from this address, because Spotify only
              sends logins back to the exact address registered for the app. Nothing was changed.
              Open <a href={LOCAL_REDIRECT_URI}>{LOCAL_REDIRECT_URI}</a> instead.
            </p>
          </>
        );
      case 'setup':
        return (
          <SetupScreen
            redirectUri={redirectUri}
            error={view.error}
            loggedOut={view.loggedOut}
            onSave={handleSave}
          />
        );
      case 'connect':
        return (
          <ConnectScreen
            clientId={view.clientId}
            redirectUri={redirectUri}
            error={view.error}
            onLogin={() => void handleLogin(view.clientId)}
            onChangeClientId={() => {
              handleForget(false);
            }}
          />
        );
      case 'connected':
        return (
          <ConnectedScreen
            profile={view.profile}
            onLogout={() => {
              handleForget(true);
            }}
          />
        );
    }
  }
}
