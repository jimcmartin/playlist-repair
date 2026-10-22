// The demo slot. Until the self-hosted video exists the page shows a marked placeholder;
// once `site/public/demo/demo.mp4` and `poster.jpg` are both there, the next build
// swaps in the video with no edit to the page.

export const DEMO_VIDEO = 'demo/demo.mp4';
export const DEMO_POSTER = 'demo/poster.jpg';

export function demoSlot(hasVideo: boolean): string {
  if (hasVideo) {
    return `<video class="demo-frame" controls preload="none" poster="/${DEMO_POSTER}" aria-label="Demo: repairing a playlist with Playlist Repair">
          <source src="/${DEMO_VIDEO}" type="video/mp4" />
          Your browser cannot play this video.
        </video>`;
  }
  return `<div class="demo-frame demo-placeholder" role="img" aria-label="Placeholder: the demo video is not ready yet">
          <p class="badge">Placeholder</p>
          <p class="demo-title">Demo video coming soon</p>
          <p class="muted">A 30-second walkthrough of scanning, reviewing and applying will go here.</p>
        </div>`;
}
