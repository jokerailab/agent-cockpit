import { deflateSync } from "node:zlib";

/**
 * Procedurally drawn tray icon: a small aperture/radar ring with a sweep hand.
 * Rendered to PNG buffers (template image on macOS). Frames at different sweep
 * angles drive the easter-egg: the menu-bar icon spins like radar when the
 * machine's agents are working hard, and rests when idle.
 */

const S = 36; // render size (2x → 18pt icon)

/* ── tiny PNG encoder (RGBA) ───────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = 0 (deflate / adaptive filter / no interlace)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ── parametric aperture drawer ────────────────────────────────── */
interface IconOpts {
  handDeg: number; // sweep hand angle (deg, 0 = right, -90 = up)
  hub: number; // hub radius
  dot: boolean; // attention dot at top of ring
  innerRing: boolean; // second inner ring (awake look)
}

function drawIcon(opts: IconOpts): Buffer {
  const buf = Buffer.alloc(S * S * 4);
  const c = (S - 1) / 2;
  const R = S * 0.42;
  const ringW = 1.6;
  const handRad = (opts.handDeg * Math.PI) / 180;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x - c;
      const dy = y - c;
      const r = Math.hypot(dx, dy);
      let a = 0;

      const ringD = Math.abs(r - R);
      if (ringD < ringW) a = Math.max(a, 1 - ringD / ringW);

      if (opts.innerRing) {
        const r2 = R * 0.55;
        const d2 = Math.abs(r - r2);
        if (d2 < 1.2) a = Math.max(a, (1 - d2 / 1.2) * 0.7);
      }

      if (r < opts.hub) a = Math.max(a, 1 - r / opts.hub);

      if (r < R && r > 1) {
        const ang = Math.atan2(dy, dx);
        const d = Math.abs(((ang - handRad + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        const perp = d * r;
        if (perp < 1.5) a = Math.max(a, (1 - perp / 1.5) * 0.95);
      }

      if (opts.dot) {
        // attention badge at top-right, just outside the ring
        const ddx = x - (c + R * 0.78);
        const ddy = y - (c - R * 0.78);
        const dr = Math.hypot(ddx, ddy);
        if (dr < 4.4) a = dr < 3.4 ? 1 : 1 - (dr - 3.4) / 1; // solid badge overrides ring
      }

      const i = (y * S + x) * 4;
      buf[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  return encodePng(S, S, buf);
}

/** Default static icon: aperture ring + resting hand pointing up. */
export function createTrayIcon(): Buffer {
  return drawIcon({ handDeg: -90, hub: 2.4, dot: false, innerRing: false });
}

/** Popover-open state: "awake" aperture — filled hub, inner ring, hand angled. */
export function createOpenIcon(): Buffer {
  return drawIcon({ handDeg: 45, hub: 3.4, dot: false, innerRing: true });
}

/** Attention state: ring with a dot at top (alerts present). */
export function createAlertIcon(): Buffer {
  return drawIcon({ handDeg: -90, hub: 2.4, dot: true, innerRing: false });
}

/** One-shot sweep frames played when the popover opens (rest → open). */
export function createOpenSweep(): Buffer[] {
  const frames: Buffer[] = [];
  const steps = 5;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    frames.push(
      drawIcon({
        handDeg: -90 + t * 135,
        hub: 2.4 + t * 1.0,
        dot: false,
        innerRing: t > 0.5
      })
    );
  }
  return frames;
}
