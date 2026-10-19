/**
 * A single, tasteful confetti burst — for the moment a game goes live.
 *
 * Hand-rolled on one canvas rather than pulled in as a dependency: ~150
 * paper flakes, simple physics (initial velocity, gravity, air drag, a
 * flutter on the x axis) and a fade over the last third of their life. The
 * canvas is created for the burst and removed when it ends, so nothing sits
 * on the page afterwards. Callers are responsible for honouring reduced motion
 * (the Countdown does); this also bails on the OS setting as a backstop.
 */

interface Flake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  spin: number;
  tilt: number;
  colour: string;
  round: boolean;
}

const DEFAULT_COLOURS = ["#ffd60a", "#30d158", "#64d2ff", "#8a72ff", "#ff375f", "#ffffff"];
const DURATION_MS = 2800;

export function fireConfetti({
  origin,
  colours = DEFAULT_COLOURS,
  count = 150,
}: {
  /** Viewport coordinates the burst leaves from; defaults to upper centre. */
  origin?: { x: number; y: number };
  colours?: string[];
  count?: number;
} = {}): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (document.documentElement.dataset.reduceMotion === "true") return;

  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: "none",
    zIndex: "2147483000",
  });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }
  ctx.scale(dpr, dpr);

  const from = origin ?? { x: width / 2, y: height * 0.35 };
  // Scale the launch speed to the viewport so a phone burst doesn't leave the screen.
  const power = Math.min(1, Math.max(0.6, height / 900));
  const flakes: Flake[] = Array.from({ length: count }, () => {
    // A fan biased upward (−90° ± 70°).
    const angle = (-90 + (Math.random() - 0.5) * 140) * (Math.PI / 180);
    const speed = (7 + Math.random() * 11) * power;
    return {
      x: from.x,
      y: from.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      rotation: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 0.3,
      tilt: Math.random() * Math.PI * 2,
      colour: colours[Math.floor(Math.random() * colours.length)],
      round: Math.random() < 0.25,
    };
  });

  const start = performance.now();
  let last = start;

  const frame = () => {
    // Read the clock here rather than trusting the rAF timestamp, whose time
    // origin some embedded engines (and test clocks) don't share.
    const now = performance.now();
    const elapsed = now - start;
    // Normalise to 60fps steps so 120Hz screens don't run the burst at double speed.
    const step = Math.min(3, (now - last) / 16.67);
    last = now;
    ctx.clearRect(0, 0, width, height);
    const fade = elapsed > DURATION_MS * 0.66 ? 1 - (elapsed - DURATION_MS * 0.66) / (DURATION_MS * 0.34) : 1;

    for (const f of flakes) {
      f.vx *= 0.985 ** step;
      f.vy = f.vy * 0.985 ** step + 0.32 * step;
      f.tilt += 0.12 * step;
      f.x += (f.vx + Math.sin(f.tilt) * 0.6) * step;
      f.y += f.vy * step;
      f.rotation += f.spin * step;

      ctx.save();
      ctx.globalAlpha = Math.max(0, fade);
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rotation);
      ctx.fillStyle = f.colour;
      if (f.round) {
        ctx.beginPath();
        ctx.arc(0, 0, f.size * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Scaling y by the flutter makes the paper look like it is turning over.
        ctx.scale(1, Math.abs(Math.cos(f.tilt)) * 0.8 + 0.2);
        ctx.fillRect(-f.size / 2, -f.size / 4, f.size, f.size / 2);
      }
      ctx.restore();
    }

    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
