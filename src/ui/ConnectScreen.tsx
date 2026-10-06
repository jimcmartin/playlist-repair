interface Props {
  clientId: string;
  redirectUri: string;
  error?: string | undefined;
  onLogin: () => void;
  onChangeClientId: () => void;
}

export function ConnectScreen({ clientId, redirectUri, error, onLogin, onChangeClientId }: Props) {
  return (
    <>
      <h2>Connect</h2>
      {error !== undefined && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        Log in with Spotify to let Playlist Repair read and edit your playlists. Nothing is changed
        until you approve it.
      </p>
      <p>
        Client ID: <code>{clientId}</code>
      </p>
      <div className="actions">
        <button type="button" onClick={onLogin}>
          Log in with Spotify
        </button>
        <button type="button" className="secondary" onClick={onChangeClientId}>
          Use a different client ID
        </button>
      </div>
      <p className="fine-print">
        If Spotify shows "INVALID_CLIENT" instead of a login page, come back to this page. "Invalid
        client" means the client ID above is wrong. "Invalid redirect URI" means the app in your
        dashboard does not list <code>{redirectUri}</code> exactly.
      </p>
    </>
  );
}
