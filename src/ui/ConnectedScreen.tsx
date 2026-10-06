import type { Profile } from '../spotify/types';

interface Props {
  profile: Profile;
  onLogout: () => void;
}

export function ConnectedScreen({ profile, onLogout }: Props) {
  return (
    <>
      <h2>Connected</h2>
      <p>
        Connected as <strong>{profile.displayName}</strong>.
      </p>
      <p>Playlist scanning is not built yet. Nothing in your account has been changed.</p>
      <div className="actions">
        <button type="button" className="secondary" onClick={onLogout}>
          Log out
        </button>
      </div>
    </>
  );
}
