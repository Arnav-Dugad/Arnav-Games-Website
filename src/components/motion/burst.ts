/**
 * A one-second particle burst from a control — for the moment you finish a
 * game. Sparks, dots and a few four-point stars fan out from the button,
 * slow under drag, drop a little and fade, with one soft shockwave ring.
 *
 * Built like `confetti.ts` (hand-rolled, no dependency) but deliberately
 * smaller: the canvas covers only a 360px square around the control rather
 * than the viewport, there are ~40 particles, and it removes itself when
 * done (with a timer backstop, since animation frames stop in hidden tabs).
 *
 * Reduced motion (OS or the in-app switch) gets no particles: the control's
 * checkmark pulses its glow instead, once. That pulse runs through the Web
 * Animations API on purpose — the global CSS that freezes animations for
 * reduced motion only reaches CSS animations, and a pulse of light is not
 * the kind of movement that setting exists to stop.
 */

const SIZE = 360;
const DURATION_MS = 1000;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  colour: string;
  kind: "dot" | "spark" | "star";
  spin: number;
  angle: number;
}

function motionReduced(): boolean {
  if (document.documentElement.dataset.reduceMotion === "true") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** The page's accent (a game's cover colour on game pages), else the brand. */
function accentOf(element: Element): string {
  const style = getComputedStyle(element);
  const accent = style.getPropertyValue("--game-accent").trim() || style.getPropertyValue("--color-brand").trim();
  return accent || "#8a72ff";
}

function pulse(element: HTMLElement, accent: string): void {
  if (typeof element.animate !== "function") return;
  element.animate(
    [
      { boxShadow: `0 0 0 0 ${accent}` },
      { boxShadow: "0 0 0 7px transparent" },
    ],
    { duration: 700, easing: "ease-out" },
  );
  const icon = element.querySelector("svg");
  icon?.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], { duration: 600, easing: "ease-in-out" });
}

function drawStar(ctx: CanvasRenderingContext2D, size: number): void {
  const inner = size * 0.28;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const radius = i % 2 === 0 ? size : inner;
    const angle = (i * Math.PI) / 4;
    ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  ctx.closePath();
  ctx.fill();
}

export function burstFrom(element: HTMLElement | null): void {
  if (typeof window === "undefined" || !element) return;
  const accent = accentOf(element);
  if (motionReduced()) {
    pulse(element, accent);
    return;
  }

  const box = element.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const canvas = document.createElement("canvas");
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "fixed",
    left: `${cx - SIZE / 2}px`,
    top: `${cy - SIZE / 2}px`,
    width: `${SIZE}px`,
    height: `${SIZE}px`,
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

  const colours = [accent, accent, "#ffd60a", "#ffffff", "#30d158", "#64d2ff"];
  const particles: Particle[] = Array.from({ length: 42 }, (_, index) => {
    // Evenly spread around the circle with jitter, so the burst reads as a ring, not a clump.
    const angle = (index / 42) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const speed = 3.2 + Math.random() * 4.2;
    const roll = Math.random();
    return {
      x: SIZE / 2,
      y: SIZE / 2,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2,
      size: roll < 0.18 ? 4 + Math.random() * 2.5 : 1.6 + Math.random() * 2.2,
      colour: colours[Math.floor(Math.random() * colours.length)],
      kind: roll < 0.18 ? "star" : roll < 0.55 ? "spark" : "dot",
      spin: (Math.random() - 0.5) * 0.25,
      angle: Math.random() * Math.PI,
    };
  });

  const start = performance.now();
  let last = start;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    canvas.remove();
  };
  // Frames stop in a hidden tab; never leave the canvas behind.
  const backstop = window.setTimeout(finish, DURATION_MS + 600);

  const frame = () => {
    if (done) return;
    const now = performance.now();
    const elapsed = now - start;
    // 60fps steps, so a 120Hz display doesn't run the burst at double speed.
    const step = Math.min(3, (now - last) / 16.67);
    last = now;
    const t = Math.min(1, elapsed / DURATION_MS);
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Shockwave: one ring that widens and fades in the first 40%.
    if (t < 0.4) {
      const ring = t / 0.4;
      ctx.globalAlpha = (1 - ring) * 0.55;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2 * (1 - ring) + 0.5;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, 14 + ring * 70, 0, Math.PI * 2);
      ctx.stroke();
    }

    const fade = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    for (const p of particles) {
      p.vx *= 0.93 ** step;
      p.vy = p.vy * 0.93 ** step + 0.12 * step;
      p.x += p.vx * step;
      p.y += p.vy * step;
      p.angle += p.spin * step;

      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = p.colour;
      ctx.strokeStyle = p.colour;
      if (p.kind === "spark") {
        // A short streak along the direction of travel.
        ctx.lineWidth = p.size * 0.7;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
        ctx.stroke();
      } else if (p.kind === "star") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        drawStar(ctx, p.size * (1 - t * 0.4));
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else {
      window.clearTimeout(backstop);
      finish();
    }
  };
  requestAnimationFrame(frame);
}
