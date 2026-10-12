/* MR עדולם SPA adapter of scroll-world's scrub technique.
 * Source: oso95/scroll-world @ 71cc36d3bb150248ae36a2c552f9cbf88802a79c
 * MIT notice: ./scroll-world-LICENSE.txt
 * The default experience uses existing brand artwork. No generated film is shipped.
 */
(() => {
  'use strict';
  // Enable only reviewed, same-origin assets. Example shape:
  // discover: { clip: '/assets/world/discover.mp4' }
  // Every next clip must start from the previous rendered last frame. Portrait
  // variants require their own approved generation budget, mobile player and continuity review.
  // This iteration intentionally keeps mobile as a linear, static story.
  const media = Object.freeze({});
  const clamp = n => Math.min(1, Math.max(0, n));
  let dispose = () => {};

  function mount(root) {
    dispose();
    const host = root.querySelector('.brand-journey');
    if (!host) return;
    const visual = host.querySelector('.journey-visual');
    const steps = [...host.querySelectorAll('.journey-step')];
    const label = host.querySelector('[data-journey-label]');
    const counter = host.querySelector('[data-journey-count]');
    if (!visual || !steps.length) return;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const small = matchMedia('(max-width: 760px)');
    const connection = navigator.connection;
    const controller = new AbortController();
    const clips = new Map();
    let frame = 0, dead = false, active = -1;

    function release(item) {
      item.controller.abort();
      if (item.video) {
        item.video.pause();
        item.video.removeAttribute('src');
        item.video.load();
        item.video.remove();
      }
      if (item.objectURL) URL.revokeObjectURL(item.objectURL);
    }

    function load(index) {
      if (clips.has(index) || motion.matches || connection?.saveData) return;
      const entry = media[steps[index]?.dataset.scene];
      // A phone never silently receives a cropped desktop film.
      const path = small.matches ? null : entry?.clip;
      if (!path || !/^\/assets\/world\/[a-z0-9-]+\.mp4$/.test(path)) return;
      const item = { controller: new AbortController(), video: null, objectURL: null, current: 0, target: 0 };
      clips.set(index, item);
      fetch(path, { signal: item.controller.signal })
        .then(response => {
          if (!response.ok || !response.headers.get('content-type')?.startsWith('video/')) throw new Error('Unavailable clip');
          return response.blob();
        })
        .then(blob => {
          if (dead || item.controller.signal.aborted) return;
          const video = document.createElement('video');
          item.video = video;
          item.objectURL = URL.createObjectURL(blob);
          video.className = 'journey-video';
          video.muted = true;
          video.playsInline = true;
          video.preload = 'auto';
          video.setAttribute('aria-hidden', 'true');
          video.setAttribute('muted', '');
          video.setAttribute('playsinline', '');
          // Keep the emblem visible until the browser has decoded an actual frame.
          const painted = () => {
            if (!dead && active === index && video.readyState >= 2) video.dataset.ready = '';
            schedule();
          };
          video.addEventListener('loadeddata', painted, { signal: item.controller.signal });
          video.addEventListener('seeked', painted, { signal: item.controller.signal });
          video.addEventListener('error', () => video.removeAttribute('data-ready'), { signal: item.controller.signal });
          video.src = item.objectURL;
          visual.appendChild(video);
        })
        .catch(() => { /* The complete text and brand artwork remain usable. */ });
    }

    function read() {
      frame = 0;
      if (dead || motion.matches || small.matches) return;
      const anchor = window.innerHeight * .55;
      const rects = steps.map(step => step.getBoundingClientRect());
      const index = Math.max(0, rects.findLastIndex(rect => rect.top <= anchor));
      const progress = clamp((anchor - rects[index].top) / Math.max(1, rects[index].height));
      if (active !== index) {
        active = index;
        visual.dataset.scene = String(index);
        label.textContent = steps[index].dataset.label;
        counter.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0');
        for (const [key, item] of clips) {
          item.video?.removeAttribute('data-ready');
          if (Math.abs(key - index) > 1) { release(item); clips.delete(key); }
        }
      }
      visual.style.setProperty('--journey-progress', String((index + progress) / steps.length));
      if (rects[0].top > window.innerHeight || rects.at(-1).bottom < 0) return;
      load(index);
      if (index + 1 < steps.length) load(index + 1);
      const item = clips.get(index), video = item?.video;
      if (!video || video.readyState < 2 || !Number.isFinite(video.duration) || !video.duration) return;
      item.target = progress;
      if (video.seeking) return; // The seeked event resumes; do not queue decoder work.
      item.current += (item.target - item.current) * .18;
      const time = Math.min(.999, item.current) * video.duration;
      if (Math.abs(video.currentTime - time) > .008) video.currentTime = time;
      video.dataset.ready = '';
      if (Math.abs(item.current - item.target) > .002) schedule();
    }

    function schedule() { if (!frame && !dead) frame = requestAnimationFrame(read); }
    function restart() { mount(root); }
    window.addEventListener('scroll', schedule, { passive: true, signal: controller.signal });
    window.addEventListener('resize', schedule, { passive: true, signal: controller.signal });
    motion.addEventListener('change', restart, { signal: controller.signal });
    small.addEventListener('change', restart, { signal: controller.signal });
    connection?.addEventListener?.('change', restart, { signal: controller.signal });
    dispose = () => {
      dead = true;
      controller.abort();
      cancelAnimationFrame(frame);
      for (const item of clips.values()) release(item);
      clips.clear();
      visual.dataset.scene = '0';
      visual.style.removeProperty('--journey-progress');
    };
    schedule();
  }

  window.mrJourney = { mount, unmount: () => dispose() };
  const app = document.getElementById('app');
  if (app) mount(app);
})();
