import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Temporary upload storage for media transcoding
const uploadDir = path.join(os.tmpdir(), 'spotify-studio-renders');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Concurrency limiter to protect server resources
let activeTranscodes = 0;
const MAX_CONCURRENT_TRANSCODES = 2;

// Export Throttling / Rate Limiting per IP
interface RateLimitRecord {
  count: number;
  resetAt: number;
}
const ipRateLimits = new Map<string, RateLimitRecord>();
const EXPORT_WINDOW_MS = 60 * 1000; // 1-minute window
const MAX_EXPORTS_PER_WINDOW = 6; // max 6 export requests per minute per IP

function exportRateLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = ipRateLimits.get(ip);

  if (!record || now > record.resetAt) {
    ipRateLimits.set(ip, { count: 1, resetAt: now + EXPORT_WINDOW_MS });
    return next();
  }

  if (record.count >= MAX_EXPORTS_PER_WINDOW) {
    const retryAfterSec = Math.ceil((record.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: `Throttling: Terlalu banyak permintaan ekspor video dari perangkat Anda. Harap tunggu ${retryAfterSec} detik sebelum mencoba kembali.`,
      retryAfter: retryAfterSec,
    });
  }

  record.count++;
  next();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || (file.fieldname === 'video' ? '.webm' : '.wav');
    cb(null, `${file.fieldname}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB max
  },
});

app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.header('Access-Control-Allow-Headers', '*');
  if (_req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static assets from public directory with CORS support
app.use(express.static(path.join(__dirname, 'public')));

app.use(express.json());

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    ffmpegAvailable: true,
    activeTranscodes,
    maxConcurrent: MAX_CONCURRENT_TRANSCODES,
  });
});

// Periodic cleanup of stale render files/sessions older than 15 minutes and expired rate limit records
setInterval(() => {
  try {
    const now = Date.now();
    for (const [key, val] of ipRateLimits.entries()) {
      if (now > val.resetAt) {
        ipRateLimits.delete(key);
      }
    }

    const items = fs.readdirSync(uploadDir);
    for (const item of items) {
      const fullPath = path.join(uploadDir, item);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > 15 * 60 * 1000) {
        if (stat.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
    }
  } catch (err) {
    console.warn('[Cleanup Warning]', err);
  }
}, 10 * 60 * 1000);

// Helper function to run FFmpeg transcode and ffprobe validation
async function runFfmpegTranscode(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  duration?: number,
  fps?: number
): Promise<void> {
  const ffmpegArgs: string[] = [
    '-nostdin',
    '-y',
  ];

  ffmpegArgs.push('-i', videoPath);
  ffmpegArgs.push('-i', audioPath);

  if (duration && duration > 0) {
    ffmpegArgs.push('-t', String(duration));
  } else {
    ffmpegArgs.push('-shortest');
  }

  ffmpegArgs.push(
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '21',
    '-profile:v', 'main',
    '-level:v', '4.1',
    '-pix_fmt', 'yuv420p',
    '-fps_mode', 'passthrough',
    '-threads', '0',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '44100',
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath
  );

  await new Promise<void>((resolve, reject) => {
    // Dynamic timeout: at least 10 minutes (600 seconds), scaled with requested video duration
    const TIMEOUT_MS = Math.max(600_000, Math.ceil((duration || 60) * 20_000));
    let hasSettled = false;

    const proc = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errorOutput = '';

    const timer = setTimeout(() => {
      if (hasSettled) return;
      hasSettled = true;
      proc.kill('SIGKILL');
      reject(new Error(`Proses FFmpeg melampaui batas waktu ${Math.round(TIMEOUT_MS / 1000)} detik (timeout).`));
    }, TIMEOUT_MS);

    proc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (hasSettled) return;
      hasSettled = true;
      if (code === 0) {
        resolve();
      } else {
        console.error('[FFmpeg Error Output]', errorOutput);
        reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput.slice(-300)}`));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (hasSettled) return;
      hasSettled = true;
      reject(err);
    });
  });

  // Validasi Output menggunakan ffprobe sebelum dikirim
  const validationArgs = [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,width,height,sample_rate,channels',
    '-show_entries', 'format=format_name,duration,size',
    '-of', 'json',
    outputPath,
  ];

  const probeResult = spawnSync('ffprobe', validationArgs);
  if (probeResult.status !== 0) {
    throw new Error(`Validasi ffprobe gagal: ${probeResult.stderr?.toString()}`);
  }

  const probeData = JSON.parse(probeResult.stdout.toString());
  const formatName = probeData.format?.format_name || '';
  const sizeBytes = Number(probeData.format?.size || 0);
  const streams = probeData.streams || [];
  const hasH264 = streams.some((s: any) => s.codec_name === 'h264');
  const hasAac = streams.some((s: any) => s.codec_name === 'aac');

  if (!formatName.includes('mp4') || sizeBytes < 1000 || !hasH264 || !hasAac) {
    throw new Error(
      `Validasi file MP4 gagal: Format bukan MP4 valid atau stream H.264/AAC tidak ditemukan (size: ${sizeBytes} bytes, format: ${formatName}, H.264: ${hasH264}, AAC: ${hasAac}).`
    );
  }
}

const chunkStorage = multer.memoryStorage();
const chunkUpload = multer({
  storage: chunkStorage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB chunk max, well within 32MB proxy limits
  },
});

/**
 * 1. Chunked Upload: Inisialisasi Session dengan Throttling Rate Limiter
 */
app.post('/api/transcode/init', exportRateLimiter, (req: express.Request, res: express.Response) => {
  if (activeTranscodes >= MAX_CONCURRENT_TRANSCODES) {
    return res.status(429).json({
      error: 'Server sedang memproses ekspor video lain. Silakan coba kembali dalam beberapa detik.',
    });
  }
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  const sessionDir = path.join(uploadDir, sessionId);
  fs.mkdirSync(sessionDir, { recursive: true });
  res.json({
    sessionId,
    chunkSize: 3 * 1024 * 1024,
  });
});

/**
 * 2. Chunked Upload: Terima potongan (chunk) binary
 */
app.post(
  '/api/transcode/chunk',
  chunkUpload.single('chunk') as any,
  (req: express.Request, res: express.Response) => {
    const { sessionId, type, chunkIndex } = req.body;
    if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
      return res.status(400).json({ error: 'Session ID tidak valid' });
    }
    if (type !== 'video' && type !== 'audio') {
      return res.status(400).json({ error: 'Tipe chunk tidak valid (wajib video atau audio)' });
    }

    const sessionDir = path.join(uploadDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      return res.status(404).json({ error: 'Session upload tidak ditemukan atau kedaluwarsa' });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Data chunk tidak ditemukan' });
    }

    const targetFile = path.join(sessionDir, type === 'video' ? 'video.webm' : 'audio.wav');
    try {
      fs.appendFileSync(targetFile, req.file.buffer);
      res.json({ success: true, chunkIndex: Number(chunkIndex) });
    } catch (err: any) {
      console.error('[Chunk Append Error]', err);
      res.status(500).json({ error: 'Gagal menulis chunk file' });
    }
  }
);

/**
 * 3. Chunked Upload: Finalisasi, jalankan FFmpeg dan streaming MP4 langsung
 */
app.post('/api/transcode/finish', async (req: express.Request, res: express.Response) => {
  const { sessionId, duration, fps } = req.body;
  if (!sessionId || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    return res.status(400).json({ error: 'Session ID tidak valid' });
  }

  const sessionDir = path.join(uploadDir, sessionId);
  if (!fs.existsSync(sessionDir)) {
    return res.status(404).json({ error: 'Session upload tidak ditemukan' });
  }

  const videoPath = path.join(sessionDir, 'video.webm');
  const audioPath = path.join(sessionDir, 'audio.wav');

  if (!fs.existsSync(videoPath) || fs.statSync(videoPath).size === 0) {
    return res.status(400).json({ error: 'Video track stream kosong atau belum selesai diunggah' });
  }
  if (!fs.existsSync(audioPath) || fs.statSync(audioPath).size === 0) {
    return res.status(400).json({ error: 'Audio track stream kosong atau belum selesai diunggah' });
  }

  if (activeTranscodes >= MAX_CONCURRENT_TRANSCODES) {
    return res.status(429).json({
      error: 'Server sedang sibuk memproses video lain. Silakan coba kembali sesaat lagi.',
    });
  }

  activeTranscodes++;
  const outputFileName = `render-${sessionId}.mp4`;
  const outputPath = path.join(uploadDir, outputFileName);

  const cleanupAll = () => {
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
    } catch {
      // ignore
    }
  };

  try {
    await runFfmpegTranscode(
      videoPath,
      audioPath,
      outputPath,
      duration ? Number(duration) : undefined,
      fps ? Number(fps) : undefined
    );

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', 'attachment; filename="spotify-canvas-h264.mp4"');

    const fileStream = fs.createReadStream(outputPath);
    fileStream.pipe(res);

    res.on('finish', cleanupAll);
    res.on('close', cleanupAll);
    fileStream.on('error', (streamErr) => {
      console.error('[FileStream Error]', streamErr);
      cleanupAll();
    });
  } catch (err: any) {
    console.error('[Finish Transcode Error]', err);
    cleanupAll();
    res.status(500).json({ error: err.message || 'Transcoding FFmpeg gagal di server.' });
  } finally {
    activeTranscodes = Math.max(0, activeTranscodes - 1);
  }
});

/**
 * Server-side FFmpeg MP4 Transcoding Endpoint (Legacy Direct Upload)
 * Menggabungkan video track dan master audio track menjadi genuine MP4 H.264 + AAC
 * divalidasi ketat dengan ffprobe sebelum dikirim ke client.
 */
app.post(
  '/api/transcode-mp4',
  exportRateLimiter,
  (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (activeTranscodes >= MAX_CONCURRENT_TRANSCODES) {
      return res.status(429).json({
        error: 'Server sedang memproses ekspor video lain. Silakan coba kembali dalam beberapa detik.',
      });
    }
    next();
  },
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'audio', maxCount: 1 },
  ]) as any,
  async (req: express.Request, res: express.Response) => {
    activeTranscodes++;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const videoFile = files?.['video']?.[0];
    const audioFile = files?.['audio']?.[0];
    const duration = req.body.duration ? Number(req.body.duration) : undefined;
    const fps = req.body.fps ? Number(req.body.fps) : undefined;

    const tempFilesToClean: string[] = [];
    if (videoFile) tempFilesToClean.push(videoFile.path);
    if (audioFile) tempFilesToClean.push(audioFile.path);

    const outputFileName = `render-${Date.now()}-${Math.random().toString(36).substring(2, 7)}.mp4`;
    const outputPath = path.join(uploadDir, outputFileName);

    try {
      if (!videoFile) {
        return res.status(400).json({ error: 'Video file diperlukan untuk transcode.' });
      }
      if (!audioFile) {
        return res.status(400).json({
          error: 'Audio file diperlukan untuk transcode MP4 (Spotify Canvas wajib menyertakan audio track).',
        });
      }

      await runFfmpegTranscode(videoFile.path, audioFile.path, outputPath, duration, fps);

      // Stream the validated MP4 file to client
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="spotify-canvas-h264.mp4"');

      const fileStream = fs.createReadStream(outputPath);
      fileStream.pipe(res);

      const cleanupOutput = () => {
        if (fs.existsSync(outputPath)) {
          fs.unlink(outputPath, () => {});
        }
      };

      res.on('finish', cleanupOutput);
      res.on('close', cleanupOutput);
      fileStream.on('error', (streamErr) => {
        console.error('[FileStream Error]', streamErr);
        cleanupOutput();
      });
    } catch (err: any) {
      console.error('[Transcode Error]', err);
      // Bersihkan file output jika ada kegagalan
      if (fs.existsSync(outputPath)) {
        fs.unlink(outputPath, () => {});
      }
      res.status(500).json({ error: err.message || 'Transcoding gagal dilakukan oleh server.' });
    } finally {
      activeTranscodes = Math.max(0, activeTranscodes - 1);
      // Clean up input temp files
      for (const tempPath of tempFilesToClean) {
        if (fs.existsSync(tempPath)) {
          fs.unlink(tempPath, () => {});
        }
      }
    }
  }
);

// Mount Vite or static server
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port: PORT },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
