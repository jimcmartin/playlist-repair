import { useState } from 'react';
import { candidateFromItem, type FixRow } from '../repair/search';

// Development only: this file is not part of the production build. It saves a
// broken track and everything its searches found as JSON, with the correct
// answer marked by hand, for tests/fixtures/real/. The file holds track
// metadata only: no tokens, no client ID, no playlist ID.

interface Props {
  row: FixRow;
  playlistName: string;
}

const NOT_MARKED = '';
const NONE = 'none';

export default function FixtureExport({ row, playlistName }: Props) {
  const [correct, setCorrect] = useState(NOT_MARKED);
  const candidates = Object.values(row.tracks).flatMap((item) => candidateFromItem(item) ?? []);

  function download() {
    const fixture = {
      version: 1,
      note: `From "${playlistName}", position ${String(row.position)}. "correct" is a candidate URI, "none", or null if not marked.`,
      dead: row.dead,
      candidates,
      correct: correct === NOT_MARKED ? null : correct,
    };
    const blob = new Blob([JSON.stringify(fixture, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const slug = row.dead.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    link.href = url;
    link.download = `fixture-${slug || 'track'}-${String(row.position)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const id = `correct-${String(row.position)}`;
  return (
    <div className="dev-panel">
      <label htmlFor={id}>Correct answer (development only)</label>
      <select
        id={id}
        value={correct}
        onChange={(e) => {
          setCorrect(e.target.value);
        }}
      >
        <option value={NOT_MARKED}>Not marked</option>
        <option value={NONE}>None of these is right</option>
        {candidates.map((c) => (
          <option key={c.uri} value={c.uri}>
            {c.title} · {c.artists.join(', ')} · {c.album}
          </option>
        ))}
      </select>
      <button type="button" className="secondary" onClick={download}>
        Export as fixture
      </button>
    </div>
  );
}
