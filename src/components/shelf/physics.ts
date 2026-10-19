/**
 * A tiny 2D rigid-body engine for the library shelf.
 *
 * Boxes only — every body is a cover or a wall — which is what makes it
 * small. The design follows Erin Catto's Box2D-Lite: separating-axis box
 * collision with reference-face clipping (up to two contact points, each with
 * a stable feature id), a sequential-impulse solver with accumulated, warm-
 * started impulses, and Baumgarte position correction. That combination is
 * what lets a pile of thin rectangles *stack* without jittering, which naive
 * penalty springs never manage.
 *
 * Additions over Box2D-Lite: restitution, a soft "mouse joint" for dragging
 * (so a cover grabbed by its corner swings naturally and keeps its momentum
 * when released), velocity clamping against tunnelling, and per-body
 * sleeping so a settled shelf costs nothing.
 *
 * Units are "world units" (the component maps 1 unit to a fixed number of
 * pixels); y points down, so gravity is positive y and a positive angle is
 * clockwise — the same convention as CSS `rotate()`.
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Body {
  id: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  w: number;
  /** Half extents. */
  hw: number;
  hh: number;
  friction: number;
  restitution: number;
  invMass: number;
  invI: number;
  mass: number;
  asleep: boolean;
  sleepTime: number;
  /** Squared bounding radius, for the broad phase. */
  radius: number;
}

interface Contact {
  /** World position. */
  px: number;
  py: number;
  nx: number;
  ny: number;
  separation: number;
  feature: number;
  pn: number;
  pt: number;
  massNormal: number;
  massTangent: number;
  bias: number;
  /** First frame of this contact: the only time it may bounce. */
  fresh: boolean;
}

interface Arbiter {
  a: Body;
  b: Body;
  contacts: Contact[];
  friction: number;
  restitution: number;
}

export interface WorldOptions {
  gravity?: number;
  iterations?: number;
}

const ALLOWED_PENETRATION = 0.01;
const BIAS_FACTOR = 0.2;
const RESTITUTION_THRESHOLD = 2;
const MAX_SPEED = 30;
const MAX_SPIN = 30;
const SLEEP_LINEAR = 0.05;
const SLEEP_ANGULAR = 0.08;
const TIME_TO_SLEEP = 0.5;
/** A body moving this fast wakes whatever it touches. */
const WAKE_SPEED = 0.3;

let nextId = 1;

export function createBody(x: number, y: number, width: number, height: number, density: number, angle = 0): Body {
  const mass = density > 0 ? density * width * height : 0;
  const inertia = mass > 0 ? (mass * (width * width + height * height)) / 12 : 0;
  return {
    id: nextId++,
    x,
    y,
    angle,
    vx: 0,
    vy: 0,
    w: 0,
    hw: width / 2,
    hh: height / 2,
    friction: 0.6,
    restitution: 0.18,
    invMass: mass > 0 ? 1 / mass : 0,
    invI: inertia > 0 ? 1 / inertia : 0,
    mass,
    asleep: false,
    sleepTime: 0,
    radius: (width * width + height * height) / 4,
  };
}

const awakeInvMass = (body: Body) => (body.asleep ? 0 : body.invMass);
const awakeInvI = (body: Body) => (body.asleep ? 0 : body.invI);

export function wake(body: Body) {
  if (body.invMass === 0) return;
  body.asleep = false;
  body.sleepTime = 0;
}

/* -------------------------------------------------------------------------- */
/* Collision: box vs box (Box2D-Lite)                                          */
/* -------------------------------------------------------------------------- */

interface ClipVertex {
  x: number;
  y: number;
  /** Packed feature pair: inEdge1 | outEdge1 << 4 | inEdge2 << 8 | outEdge2 << 12. */
  fp: number;
}

const IN1 = 0;
const OUT1 = 4;
const IN2 = 8;
const OUT2 = 12;
const setEdge = (fp: number, slot: number, edge: number) => (fp & ~(0xf << slot)) | (edge << slot);
const flip = (fp: number) =>
  (((fp >> IN2) & 0xf) << IN1) | (((fp >> OUT2) & 0xf) << OUT1) | (((fp >> IN1) & 0xf) << IN2) | (((fp >> OUT1) & 0xf) << OUT2);

function clipSegment(input: ClipVertex[], nx: number, ny: number, offset: number, clipEdge: number): ClipVertex[] {
  const out: ClipVertex[] = [];
  const d0 = nx * input[0].x + ny * input[0].y - offset;
  const d1 = nx * input[1].x + ny * input[1].y - offset;
  if (d0 <= 0) out.push(input[0]);
  if (d1 <= 0) out.push(input[1]);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    const x = input[0].x + t * (input[1].x - input[0].x);
    const y = input[0].y + t * (input[1].y - input[0].y);
    const fp = d0 > 0
      ? setEdge(setEdge(input[0].fp, IN1, clipEdge), IN2, 0)
      : setEdge(setEdge(input[1].fp, OUT1, clipEdge), OUT2, 0);
    out.push({ x, y, fp });
  }
  return out;
}

/** The incident box's edge most anti-parallel to the reference normal. */
function incidentEdge(hx: number, hy: number, px: number, py: number, c: number, s: number, nx: number, ny: number): ClipVertex[] {
  // Normal into the incident box's frame, flipped.
  const lx = -(c * nx + s * ny);
  const ly = -(-s * nx + c * ny);
  let v: Array<[number, number, number, number]>;
  if (Math.abs(lx) > Math.abs(ly)) {
    v = lx > 0
      ? [[hx, -hy, 3, 4], [hx, hy, 4, 1]]
      : [[-hx, hy, 1, 2], [-hx, -hy, 2, 3]];
  } else {
    v = ly > 0
      ? [[hx, hy, 4, 1], [-hx, hy, 1, 2]]
      : [[-hx, -hy, 2, 3], [hx, -hy, 3, 4]];
  }
  return v.map(([x, y, inEdge, outEdge]) => ({
    x: px + c * x - s * y,
    y: py + s * x + c * y,
    fp: (inEdge << IN2) | (outEdge << OUT2),
  }));
}

function collide(a: Body, b: Body): Contact[] {
  const ca = Math.cos(a.angle);
  const sa = Math.sin(a.angle);
  const cb = Math.cos(b.angle);
  const sb = Math.sin(b.angle);
  const dpx = b.x - a.x;
  const dpy = b.y - a.y;
  // dp in each box's frame.
  const dAx = ca * dpx + sa * dpy;
  const dAy = -sa * dpx + ca * dpy;
  const dBx = cb * dpx + sb * dpy;
  const dBy = -sb * dpx + cb * dpy;
  // C = RotA^T * RotB.
  const c11 = ca * cb + sa * sb;
  const c12 = -ca * sb + sa * cb;
  const c21 = -sa * cb + ca * sb;
  const c22 = sa * sb + ca * cb;
  const a11 = Math.abs(c11);
  const a12 = Math.abs(c12);
  const a21 = Math.abs(c21);
  const a22 = Math.abs(c22);

  const faceAx = Math.abs(dAx) - a.hw - (a11 * b.hw + a12 * b.hh);
  const faceAy = Math.abs(dAy) - a.hh - (a21 * b.hw + a22 * b.hh);
  if (faceAx > 0 || faceAy > 0) return [];
  const faceBx = Math.abs(dBx) - (a11 * a.hw + a21 * a.hh) - b.hw;
  const faceBy = Math.abs(dBy) - (a12 * a.hw + a22 * a.hh) - b.hh;
  if (faceBx > 0 || faceBy > 0) return [];

  const relTol = 0.95;
  const absTol = 0.01;
  let axis = 0;
  let separation = faceAx;
  let nx = dAx > 0 ? ca : -ca;
  let ny = dAx > 0 ? sa : -sa;
  if (faceAy > relTol * separation + absTol * a.hh) {
    axis = 1;
    separation = faceAy;
    nx = dAy > 0 ? -sa : sa;
    ny = dAy > 0 ? ca : -ca;
  }
  if (faceBx > relTol * separation + absTol * b.hw) {
    axis = 2;
    separation = faceBx;
    nx = dBx > 0 ? cb : -cb;
    ny = dBx > 0 ? sb : -sb;
  }
  if (faceBy > relTol * separation + absTol * b.hh) {
    axis = 3;
    separation = faceBy;
    nx = dBy > 0 ? -sb : sb;
    ny = dBy > 0 ? cb : -cb;
  }

  let fnx: number, fny: number, front: number, snx: number, sny: number, negSide: number, posSide: number;
  let negEdge: number, posEdge: number, incident: ClipVertex[];
  if (axis === 0 || axis === 1) {
    fnx = nx;
    fny = ny;
    const along = axis === 0;
    front = a.x * fnx + a.y * fny + (along ? a.hw : a.hh);
    snx = along ? -sa : ca;
    sny = along ? ca : sa;
    const side = a.x * snx + a.y * sny;
    const half = along ? a.hh : a.hw;
    negSide = -side + half;
    posSide = side + half;
    negEdge = along ? 3 : 2;
    posEdge = along ? 1 : 4;
    incident = incidentEdge(b.hw, b.hh, b.x, b.y, cb, sb, fnx, fny);
  } else {
    fnx = -nx;
    fny = -ny;
    const along = axis === 2;
    front = b.x * fnx + b.y * fny + (along ? b.hw : b.hh);
    snx = along ? -sb : cb;
    sny = along ? cb : sb;
    const side = b.x * snx + b.y * sny;
    const half = along ? b.hh : b.hw;
    negSide = -side + half;
    posSide = side + half;
    negEdge = along ? 3 : 2;
    posEdge = along ? 1 : 4;
    incident = incidentEdge(a.hw, a.hh, a.x, a.y, ca, sa, fnx, fny);
  }

  const clip1 = clipSegment(incident, -snx, -sny, negSide, negEdge);
  if (clip1.length < 2) return [];
  const clip2 = clipSegment(clip1, snx, sny, posSide, posEdge);
  if (clip2.length < 2) return [];

  const contacts: Contact[] = [];
  for (const point of clip2) {
    const sep = fnx * point.x + fny * point.y - front;
    if (sep <= 0) {
      contacts.push({
        px: point.x - sep * fnx,
        py: point.y - sep * fny,
        nx,
        ny,
        separation: sep,
        feature: axis >= 2 ? flip(point.fp) : point.fp,
        pn: 0,
        pt: 0,
        massNormal: 0,
        massTangent: 0,
        bias: 0,
        fresh: true,
      });
    }
  }
  return contacts;
}

/* -------------------------------------------------------------------------- */
/* Drag joint (Box2D's mouse joint)                                           */
/* -------------------------------------------------------------------------- */

export interface DragJoint {
  body: Body;
  /** Grab point in the body's local frame. */
  lx: number;
  ly: number;
  tx: number;
  ty: number;
  ix: number;
  iy: number;
  // Per-step solver state.
  rx: number;
  ry: number;
  m11: number;
  m12: number;
  m22: number;
  cx: number;
  cy: number;
  gamma: number;
}

export function createDrag(body: Body, worldX: number, worldY: number): DragJoint {
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  const dx = worldX - body.x;
  const dy = worldY - body.y;
  wake(body);
  return { body, lx: c * dx + s * dy, ly: -s * dx + c * dy, tx: worldX, ty: worldY, ix: 0, iy: 0, rx: 0, ry: 0, m11: 0, m12: 0, m22: 0, cx: 0, cy: 0, gamma: 0 };
}

function dragPreStep(joint: DragJoint, dt: number) {
  const body = joint.body;
  const frequency = 6;
  const damping = 0.75;
  const omega = 2 * Math.PI * frequency;
  const d = 2 * body.mass * damping * omega;
  const k = body.mass * omega * omega;
  const gamma = dt * (d + dt * k);
  joint.gamma = gamma ? 1 / gamma : 0;
  const beta = dt * k * joint.gamma;
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  joint.rx = c * joint.lx - s * joint.ly;
  joint.ry = s * joint.lx + c * joint.ly;
  const { rx, ry } = joint;
  const k11 = body.invMass + body.invI * ry * ry + joint.gamma;
  const k12 = -body.invI * rx * ry;
  const k22 = body.invMass + body.invI * rx * rx + joint.gamma;
  const det = k11 * k22 - k12 * k12;
  const inv = det ? 1 / det : 0;
  joint.m11 = inv * k22;
  joint.m12 = -inv * k12;
  joint.m22 = inv * k11;
  joint.cx = (body.x + rx - joint.tx) * beta;
  joint.cy = (body.y + ry - joint.ty) * beta;
  // A little spin damping keeps a held cover from twirling forever.
  body.w *= 0.96;
  body.vx += body.invMass * joint.ix;
  body.vy += body.invMass * joint.iy;
  body.w += body.invI * (rx * joint.iy - ry * joint.ix);
}

function dragSolve(joint: DragJoint, dt: number) {
  const body = joint.body;
  const { rx, ry } = joint;
  const cdx = body.vx - body.w * ry;
  const cdy = body.vy + body.w * rx;
  const bx = -(cdx + joint.cx + joint.gamma * joint.ix);
  const by = -(cdy + joint.cy + joint.gamma * joint.iy);
  let impX = joint.m11 * bx + joint.m12 * by;
  let impY = joint.m12 * bx + joint.m22 * by;
  const oldX = joint.ix;
  const oldY = joint.iy;
  joint.ix += impX;
  joint.iy += impY;
  const maxImpulse = 400 * body.mass * dt;
  const length = Math.hypot(joint.ix, joint.iy);
  if (length > maxImpulse) {
    joint.ix *= maxImpulse / length;
    joint.iy *= maxImpulse / length;
  }
  impX = joint.ix - oldX;
  impY = joint.iy - oldY;
  body.vx += body.invMass * impX;
  body.vy += body.invMass * impY;
  body.w += body.invI * (rx * impY - ry * impX);
}

/* -------------------------------------------------------------------------- */
/* World                                                                      */
/* -------------------------------------------------------------------------- */

export class World {
  bodies: Body[] = [];
  drag: DragJoint | null = null;
  gravity: number;
  iterations: number;
  private arbiters = new Map<number, Arbiter>();

  constructor({ gravity = 24, iterations = 10 }: WorldOptions = {}) {
    this.gravity = gravity;
    this.iterations = iterations;
  }

  add(body: Body) {
    this.bodies.push(body);
    return body;
  }

  clear() {
    this.bodies = [];
    this.arbiters.clear();
    this.drag = null;
  }

  /** Moves the held point; the joint pulls the body after it. */
  moveDrag(x: number, y: number) {
    if (!this.drag) return;
    this.drag.tx = x;
    this.drag.ty = y;
  }

  /** True once every dynamic body has gone to sleep and nothing is held. */
  get settled(): boolean {
    return !this.drag && this.bodies.every((body) => body.invMass === 0 || body.asleep);
  }

  wakeAll() {
    for (const body of this.bodies) wake(body);
  }

  step(dt: number) {
    const invDt = dt > 0 ? 1 / dt : 0;
    this.broadPhase();

    for (const body of this.bodies) {
      if (body.invMass === 0 || body.asleep) continue;
      body.vy += dt * this.gravity;
    }

    for (const arbiter of this.arbiters.values()) this.preStep(arbiter, invDt);
    if (this.drag) dragPreStep(this.drag, dt);

    for (let i = 0; i < this.iterations; i++) {
      for (const arbiter of this.arbiters.values()) this.applyImpulse(arbiter);
      if (this.drag) dragSolve(this.drag, dt);
    }

    for (const body of this.bodies) {
      if (body.invMass === 0 || body.asleep) continue;
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > MAX_SPEED) {
        body.vx *= MAX_SPEED / speed;
        body.vy *= MAX_SPEED / speed;
      }
      body.w = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, body.w));
      body.x += dt * body.vx;
      body.y += dt * body.vy;
      body.angle += dt * body.w;

      const held = this.drag?.body === body;
      if (!held && speed < SLEEP_LINEAR && Math.abs(body.w) < SLEEP_ANGULAR) {
        body.sleepTime += dt;
        if (body.sleepTime > TIME_TO_SLEEP) {
          body.asleep = true;
          body.vx = 0;
          body.vy = 0;
          body.w = 0;
        }
      } else {
        body.sleepTime = 0;
      }
    }
  }

  private broadPhase() {
    const bodies = this.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];
        const key = a.id * 4096 + b.id;
        const staticA = a.invMass === 0 || a.asleep;
        const staticB = b.invMass === 0 || b.asleep;
        if (staticA && staticB) {
          // Two resting bodies keep their old contact (and its warm-start
          // impulse) so waking one doesn't make the pile pop.
          continue;
        }
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const reach = Math.sqrt(a.radius) + Math.sqrt(b.radius);
        if (dx * dx + dy * dy > reach * reach) {
          this.separate(key);
          continue;
        }
        const contacts = collide(a, b);
        if (contacts.length === 0) {
          this.separate(key);
          continue;
        }
        // Something moving fast enough, or held, wakes what it hits.
        const held = this.drag?.body;
        if (a.asleep && (held === b || Math.hypot(b.vx, b.vy) + Math.abs(b.w) * 0.5 > WAKE_SPEED)) wake(a);
        if (b.asleep && (held === a || Math.hypot(a.vx, a.vy) + Math.abs(a.w) * 0.5 > WAKE_SPEED)) wake(b);

        const existing = this.arbiters.get(key);
        if (existing) {
          // Carry accumulated impulses across frames by feature id.
          for (const contact of contacts) {
            const old = existing.contacts.find((item) => item.feature === contact.feature);
            if (old) {
              contact.pn = old.pn;
              contact.pt = old.pt;
              contact.fresh = false;
            }
          }
          existing.contacts = contacts;
        } else {
          this.arbiters.set(key, {
            a,
            b,
            contacts,
            friction: Math.sqrt(a.friction * b.friction),
            restitution: Math.max(a.restitution, b.restitution),
          });
        }
      }
    }
  }

  /**
   * Two bodies stopped touching. A sleeper that just lost a support must
   * wake, or it would hang in the air where its neighbour used to be.
   */
  private separate(key: number) {
    const arbiter = this.arbiters.get(key);
    if (!arbiter) return;
    if (arbiter.a.asleep) wake(arbiter.a);
    if (arbiter.b.asleep) wake(arbiter.b);
    this.arbiters.delete(key);
  }

  private preStep(arbiter: Arbiter, invDt: number) {
    const { a, b } = arbiter;
    const imA = awakeInvMass(a);
    const imB = awakeInvMass(b);
    const iiA = awakeInvI(a);
    const iiB = awakeInvI(b);
    for (const c of arbiter.contacts) {
      const r1x = c.px - a.x;
      const r1y = c.py - a.y;
      const r2x = c.px - b.x;
      const r2y = c.py - b.y;
      const rn1 = r1x * c.nx + r1y * c.ny;
      const rn2 = r2x * c.nx + r2y * c.ny;
      const kNormal = imA + imB + iiA * (r1x * r1x + r1y * r1y - rn1 * rn1) + iiB * (r2x * r2x + r2y * r2y - rn2 * rn2);
      c.massNormal = kNormal > 0 ? 1 / kNormal : 0;
      const tx = c.ny;
      const ty = -c.nx;
      const rt1 = r1x * tx + r1y * ty;
      const rt2 = r2x * tx + r2y * ty;
      const kTangent = imA + imB + iiA * (r1x * r1x + r1y * r1y - rt1 * rt1) + iiB * (r2x * r2x + r2y * r2y - rt2 * rt2);
      c.massTangent = kTangent > 0 ? 1 / kTangent : 0;

      // Position correction, or a bounce when bodies first meet fast enough.
      // Bouncing only on a *fresh* contact matters: a resting cover rocks a
      // little, and re-applying restitution to that persistent contact
      // pumps energy in until the pile never settles.
      const correction = -BIAS_FACTOR * invDt * Math.min(0, c.separation + ALLOWED_PENETRATION);
      c.bias = correction;
      if (c.fresh) {
        const dvx = b.vx - b.w * r2y - (a.vx - a.w * r1y);
        const dvy = b.vy + b.w * r2x - (a.vy + a.w * r1x);
        const vn = dvx * c.nx + dvy * c.ny;
        if (vn < -RESTITUTION_THRESHOLD) c.bias = Math.max(correction, -arbiter.restitution * vn);
      }

      // Warm start.
      const px = c.pn * c.nx + c.pt * tx;
      const py = c.pn * c.ny + c.pt * ty;
      a.vx -= imA * px;
      a.vy -= imA * py;
      a.w -= iiA * (r1x * py - r1y * px);
      b.vx += imB * px;
      b.vy += imB * py;
      b.w += iiB * (r2x * py - r2y * px);
    }
  }

  private applyImpulse(arbiter: Arbiter) {
    const { a, b } = arbiter;
    const imA = awakeInvMass(a);
    const imB = awakeInvMass(b);
    const iiA = awakeInvI(a);
    const iiB = awakeInvI(b);
    for (const c of arbiter.contacts) {
      const r1x = c.px - a.x;
      const r1y = c.py - a.y;
      const r2x = c.px - b.x;
      const r2y = c.py - b.y;

      let dvx = b.vx - b.w * r2y - (a.vx - a.w * r1y);
      let dvy = b.vy + b.w * r2x - (a.vy + a.w * r1x);
      const vn = dvx * c.nx + dvy * c.ny;
      let dPn = c.massNormal * (-vn + c.bias);
      const pn0 = c.pn;
      c.pn = Math.max(pn0 + dPn, 0);
      dPn = c.pn - pn0;
      let px = dPn * c.nx;
      let py = dPn * c.ny;
      a.vx -= imA * px;
      a.vy -= imA * py;
      a.w -= iiA * (r1x * py - r1y * px);
      b.vx += imB * px;
      b.vy += imB * py;
      b.w += iiB * (r2x * py - r2y * px);

      dvx = b.vx - b.w * r2y - (a.vx - a.w * r1y);
      dvy = b.vy + b.w * r2x - (a.vy + a.w * r1x);
      const tx = c.ny;
      const ty = -c.nx;
      const vt = dvx * tx + dvy * ty;
      let dPt = c.massTangent * -vt;
      const maxPt = arbiter.friction * c.pn;
      const pt0 = c.pt;
      c.pt = Math.max(-maxPt, Math.min(pt0 + dPt, maxPt));
      dPt = c.pt - pt0;
      px = dPt * tx;
      py = dPt * ty;
      a.vx -= imA * px;
      a.vy -= imA * py;
      a.w -= iiA * (r1x * py - r1y * px);
      b.vx += imB * px;
      b.vy += imB * py;
      b.w += iiB * (r2x * py - r2y * px);
    }
  }
}
