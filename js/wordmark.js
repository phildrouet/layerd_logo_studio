// The Layerd wordmark: the brand's own lettering (vector paths taken from
// the logo lockup, assets/layerd-wordmark.svg; "Layerd" only, no "AI"), placed against the mark with
// the brand lockup proportions and composited flat over the finished image.
// Preview and video draw it in the finish shader from a texture rasterised
// at its on-screen size; stills draw the SVG itself on the stitched canvas,
// so it is crisp at any print size.

// Lockup proportions measured from the brand lockups, as fractions of the
// mark's width (the mark is 0.934 times as tall as it is wide).
export const LOCKUP = {
  side: { cap: 0.469, gap: 0.233 },     // horizontal lockup: caps centred on the mark
  stacked: { cap: 0.357, gap: 0.189 },  // landscape lockup: centred under (or over) the mark
  markAspect: 0.934,
  freeWidth: 0.3,                       // no mark (Ripple): wordmark width as a fraction of the frame
  fit: [0.84, 0.8],                     // a centred lockup fits within this share of the frame (w, h)
};

let svgText = null;
let meta = null;          // viewBox and cap metrics of the wordmark SVG
let white = null;         // white wordmark image, for rasterising textures
const coloured = new Map();

function imageFor(colour) {
  const svg = svgText.replace(/fill="#[0-9A-Fa-f]{6}"/g, `fill="${colour}"`);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return img.decode().then(() => img);
}

export async function loadWordmark(url = 'assets/layerd-wordmark.svg') {
  svgText = await (await fetch(url)).text();
  const [x, y, w, h] = svgText.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
  meta = {
    x, y, w, h,
    capTop: Number(svgText.match(/data-cap-top="([^"]+)"/)[1]),
    baseline: Number(svgText.match(/data-baseline="([^"]+)"/)[1]),
  };
  white = await imageFor('#FFFFFF');
}

export function wordmarkReady() {
  return !!white;
}

// The wordmark in a given colour, for drawing on a 2D canvas.
export function wordmarkImage(colour) {
  if (!coloured.has(colour)) coloured.set(colour, imageFor(colour));
  return coloured.get(colour);
}

// Rasterise the white wordmark into a canvas of w x h pixels.
export function rasteriseWordmark(canvas, w, h) {
  if (!white) return false;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(white, 0, 0, w, h);
  return true;
}

// Lockup geometry. All maths in frame-height units (x 0..aspect, y 0..1, y
// down). mark: { cx, cy, w } projected mark centre and width, or null when
// there is no mark (the wordmark is then centred in the frame).
// With centre on, the lens shifts so mark plus wordmark sit centred, and
// zooms out (zoom > 1) if the lockup would not fit inside LOCKUP.fit.
// Returns { zoom, offX, offY, rect }: offX / offY move the content (in
// fractions of the unzoomed frame), rect is the wordmark in the final frame.
export function lockupLayout(wm, mark, aspect) {
  if (!meta) return null;
  let X0, Y0, W, H, offX = 0, offY = 0, zoom = 1;
  if (!mark) {
    W = LOCKUP.freeWidth * wm.size * aspect;
    H = W * (meta.h / meta.w);
    X0 = (aspect - W) / 2;
    Y0 = (1 - H) / 2;
  } else {
    const side = wm.position === 'left' || wm.position === 'right';
    const k = side ? LOCKUP.side : LOCKUP.stacked;
    const s = (k.cap * wm.size * mark.w) / (meta.baseline - meta.capTop);
    W = s * meta.w;
    H = s * meta.h;
    const capTop = (meta.capTop - meta.y) * s;
    const base = (meta.baseline - meta.y) * s;
    const gap = k.gap * wm.gap * mark.w;
    const mh = LOCKUP.markAspect * mark.w;
    if (side) {
      Y0 = mark.cy - (capTop + base) / 2;
      X0 = wm.position === 'right' ? mark.cx + mark.w / 2 + gap : mark.cx - mark.w / 2 - gap - W;
    } else {
      X0 = mark.cx - W / 2;
      Y0 = wm.position === 'below' ? mark.cy + mh / 2 + gap - capTop : mark.cy - mh / 2 - gap - H;
    }
    if (wm.centre) {
      const ux0 = Math.min(X0, mark.cx - mark.w / 2), ux1 = Math.max(X0 + W, mark.cx + mark.w / 2);
      const uy0 = Math.min(Y0, mark.cy - mh / 2), uy1 = Math.max(Y0 + H, mark.cy + mh / 2);
      offX = aspect / 2 - (ux0 + ux1) / 2;
      offY = 0.5 - (uy0 + uy1) / 2;
      zoom = Math.max(1, (ux1 - ux0) / (aspect * LOCKUP.fit[0]), (uy1 - uy0) / LOCKUP.fit[1]);
    }
  }
  // Final frame position: about the frame centre, after the offset, / zoom.
  const fx = (x) => aspect / 2 + (x + offX - aspect / 2) / zoom;
  const fy = (y) => 0.5 + (y + offY - 0.5) / zoom;
  return {
    zoom,
    offX: offX / aspect,
    offY,
    rect: { x: fx(X0) / aspect, y: fy(Y0), w: W / zoom / aspect, h: H / zoom },
  };
}
