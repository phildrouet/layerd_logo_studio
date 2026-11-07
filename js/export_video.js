// Loop video export. Frames are rendered deterministically (phase advances
// 2 pi over the loop duration, light sweep included) and fed non-realtime to
// a WebCodecs H.264 encoder muxed into MP4. Falls back to MediaRecorder
// (WebM, realtime capture) where WebCodecs is unavailable.

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';

export const VIDEO_SAMPLES = 24;

export function webCodecsAvailable() {
  return typeof window.VideoEncoder === 'function';
}

async function pickAvcCodec(width, height, fps, bitrate) {
  const candidates = ['avc1.640034', 'avc1.640033', 'avc1.64002A', 'avc1.640028', 'avc1.4d0028'];
  for (const codec of candidates) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec, width, height, framerate: fps, bitrate,
      });
      if (supported) return codec;
    } catch { /* try next */ }
  }
  return null;
}

export async function exportVideoMp4(world, accum, params, opts, renderFrameAt, onProgress) {
  const { width, height, fps, seconds } = opts;
  const frameCount = Math.round(fps * seconds);
  const bitrate = width >= 3000 ? 45_000_000 : 16_000_000;
  const codec = await pickAvcCodec(width, height, fps, bitrate);
  if (!codec) throw new Error('No supported H.264 encoder configuration found');

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height },
    fastStart: 'in-memory',
  });

  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure({ codec, width, height, framerate: fps, bitrate });

  const canvas = accum.renderer.domElement;
  for (let i = 0; i < frameCount; i++) {
    if (encodeError) throw encodeError;
    const u = (i / frameCount) * (seconds / params.loop.duration);
    await renderFrameAt(u % 1, width, height, i);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (encoder.encodeQueueSize > 4) await sleep(10);
    onProgress?.((i + 1) / frameCount, 'Rendering frames');
  }
  await encoder.flush();
  muxer.finalize();
  onProgress?.(1, 'Finalising MP4');
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

// Fallback: realtime WebM capture of the preview canvas.
export async function exportVideoWebm(accum, opts, startPlayback, stopPlayback, onProgress) {
  const { fps, seconds } = opts;
  const canvas = accum.renderer.domElement;
  const stream = canvas.captureStream(fps);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });
  rec.start(250);
  startPlayback();
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    onProgress?.((performance.now() - t0) / (seconds * 1000), 'Recording');
    await sleep(100);
  }
  stopPlayback();
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: 'video/webm' });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
