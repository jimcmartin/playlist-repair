import { useId, useState, type SyntheticEvent } from 'react';
import { DASHBOARD_URL, MANAGE_APPS_URL } from '../config';
import { normalizeClientId } from '../spotify/auth';

interface Props {
  redirectUri: string;
  error?: string | undefined;
  loggedOut?: boolean | undefined;
  onSave: (clientId: string) => void;
}

export function SetupScreen({ redirectUri, error, loggedOut, onSave }: Props) {
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);

  function handleSubmit(event: SyntheticEvent) {
    event.preventDefault();
    const clientId = normalizeClientId(value);
    if (clientId === null) {
      setInvalid(true);
      return;
    }
    onSave(clientId);
  }

  return (
    <>
      <h2>Set up</h2>
      {loggedOut && (
        <p role="status" className="notice">
          You are logged out. Your client ID and login were removed from this browser. To revoke
          access as well, remove the app under{' '}
          <a href={MANAGE_APPS_URL} target="_blank" rel="noreferrer">
            Manage apps
          </a>{' '}
          in your Spotify account.
        </p>
      )}
      {error !== undefined && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p>
        Playlist Repair connects to Spotify through an app that you create in your own Spotify
        developer account. You need Spotify Premium to create one.
      </p>
      <ol>
        <li>
          Open the{' '}
          <a href={DASHBOARD_URL} target="_blank" rel="noreferrer">
            Spotify developer dashboard
          </a>{' '}
          and choose <strong>Create app</strong>.
        </li>
        <li>Give it any name and description. The name must not contain "Spotify".</li>
        <li>
          Set the redirect URI to <code>{redirectUri}</code>, exactly as written, including the
          final slash.
        </li>
        <li>
          Choose <strong>Web API</strong>, accept the terms and save.
        </li>
        <li>
          Copy the <strong>Client ID</strong> and paste it below. Do not copy the client secret.
          Playlist Repair never needs it.
        </li>
      </ol>
      <form onSubmit={handleSubmit} noValidate>
        <label htmlFor={inputId}>Client ID</label>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
        />
        {invalid && (
          <p id={errorId} role="alert" className="error">
            That is not a client ID, so nothing was saved. A client ID is 32 letters and digits.
            Copy it again from your app's settings in the dashboard.
          </p>
        )}
        <button type="submit">Save client ID</button>
      </form>
      <p className="fine-print">
        The client ID is stored in this browser only. It is not a secret, and it is sent only to
        Spotify.
      </p>
    </>
  );
}
