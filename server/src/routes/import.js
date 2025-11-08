import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import { config } from '../config.js';
import { getPool } from '../db.js';
import { progressBus, emitProgress } from '../services/progress.js';
import { readImageMeta, readPdfMeta, readPptMeta, readAudioMeta } from '../services/metadata.js';

export const importRouter = Router();

/* ------------------------------ Helpers ------------------------------ */
function detectMimeType(fullPath) {
  const ext = path.extname(fullPath).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.png':  return 'image/png';
    case '.gif':  return 'image/gif';
    case '.webp': return 'image/webp';
    case '.pdf':  return 'application/pdf';
    case '.ppt':  return 'application/vnd.ms-powerpoint';
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case '.mp3':  return 'audio/mpeg';
    case '.wav':  return 'audio/wav';
    case '.m4a':  return 'audio/mp4';
    case '.flac': return 'audio/flac';
    case '.ogg':  return 'audio/ogg';
    default:      return 'application/octet-stream';
  }
}

async function sha256File(fullPath) {
  return new Promise((resolve, reject) => {
    try {
      const hash = crypto.createHash('sha256');
      const s = fs.createReadStream(fullPath);
      s.on('error', (e) => reject(e));
      s.on('data', (d) => hash.update(d));
      s.on('end', () => resolve(hash.digest('hex')));
    } catch (e) {
      reject(e);
    }
  });
}

async function scanDir(rootDir, allowedExts) {
  const out = [];
  if (!rootDir || !fs.existsSync(rootDir)) return out;
  const so = { withFileTypes: true };
  async function walk(d) {
    let entries = [];
    try { entries = await fs.promises.readdir(d, so); } catch { return; }
    for (const ent of entries) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (allowedExts.some((e) => ent.name.toLowerCase().endsWith(e))) {
        out.push(full);
      }
    }
  }
  await walk(rootDir);
  return out;
}

function same(a, b) {
  if (a === null || a === undefined) a = null;
  if (b === null || b === undefined) b = null;
  // normalisera datumsträngar "YYYY-MM-DD HH:MM:SS"
  if (a instanceof Date) a = a.toISOString().slice(0,19).replace('T',' ');
  if (b instanceof Date) b = b.toISOString().slice(0,19).replace('T',' ');
  return String(a) === String(b);
}

/* =========================== Global abort =========================== */
let currentJob = null; // { cancelled:boolean, startedAt:number }

/* =========================== /api/import/count =========================== */
importRouter.get('/count', async (_req, res) => {
  try {
    const cfg = config.dirs || {};
    const counts = {
      images: (await scanDir(cfg.image, ['.jpg', '.jpeg', '.png', '.gif', '.webp'])).length,
      pdfs:   (await scanDir(cfg.pdf,   ['.pdf'])).length,
      ppts:   (await scanDir(cfg.ppt,   ['.ppt', '.pptx'])).length,
      music:  (await scanDir(cfg.music, ['.mp3', '.wav', '.m4a', '.flac', '.ogg'])).length,
    };
    counts.total = counts.images + counts.pdfs + counts.ppts + counts.music;
    res.json(counts);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* ========================= /api/import/stream (SSE) ========================= */
importRouter.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (msg) => { try { res.write(`data: ${JSON.stringify(msg)}\n\n`); } catch {} };
  send({ phase: 'connected', message: 'SSE connected' });

  const onMsg = (m) => send(m);
  progressBus.on('message', onMsg);

  const hb = setInterval(() => {
    try {
      res.write('event: ping\n');
      res.write(`data: {"ts":${Date.now()}}\n\n`);
    } catch {}
  }, 10000);

  req.on('close', () => {
    clearInterval(hb);
    progressBus.off('message', onMsg);
  });
});

/* =========================== /api/import/abort =========================== */
importRouter.post('/abort', async (_req, res) => {
  if (currentJob) {
    currentJob.cancelled = true;
    emitProgress({ phase: 'aborting', message: 'Abort requested' });
    return res.json({ ok: true });
  }
  res.json({ ok: false, message: 'No job running' });
});

/* ============================ /api/import/run ============================ */
importRouter.post('/run', async (_req, res) => {
  try { res.status(202).json({ started: true }); } catch {}

  // start job
  currentJob = { cancelled: false, startedAt: Date.now() };

  /* 1) DB pool + ping */
  emitProgress({ phase: 'health', step: 'getPool:start' });
  let pool;
  try {
    pool = await getPool();
    emitProgress({ phase: 'health', step: 'getPool:ok' });
  } catch (e) {
    emitProgress({ phase: 'fatal', message: 'DB pool creation failed: ' + String(e) });
    currentJob = null;
    return;
  }

  try {
    const [r] = await pool.query('SELECT 1 AS ok');
    const ok = r && r[0] && (r[0].ok === 1 || r[0].ok == 1);
    emitProgress({ phase: 'health', step: 'db:ping', ok });
    if (!ok) {
      emitProgress({ phase: 'fatal', message: 'DB ping returned unexpected value' });
      currentJob = null;
      return;
    }
  } catch (e) {
    emitProgress({ phase: 'fatal', message: 'DB ping failed: ' + String(e) });
    currentJob = null;
    return;
  }

  /* 2) Kataloger + skanning */
  const cfg = config.dirs || {};
  const dirInfo = { image: cfg.image, pdf: cfg.pdf, ppt: cfg.ppt, music: cfg.music };
  const dirExists = {
    image: !!(dirInfo.image && fs.existsSync(dirInfo.image)),
    pdf:   !!(dirInfo.pdf   && fs.existsSync(dirInfo.pdf)),
    ppt:   !!(dirInfo.ppt   && fs.existsSync(dirInfo.ppt)),
    music: !!(dirInfo.music && fs.existsSync(dirInfo.music))
  };
  emitProgress({ phase: 'health', step: 'dirs', dirs: dirInfo, exists: dirExists });

  const files = {
    images: await scanDir(dirInfo.image, ['.jpg', '.jpeg', '.png', '.gif', '.webp']),
    pdfs:   await scanDir(dirInfo.pdf,   ['.pdf']),
    ppts:   await scanDir(dirInfo.ppt,   ['.ppt', '.pptx']),
    music:  await scanDir(dirInfo.music, ['.mp3', '.wav', '.m4a', '.flac', '.ogg']),
  };
  emitProgress({ phase: 'health', step: 'scan:done',
    images: files.images.length, pdfs: files.pdfs.length, ppts: files.ppts.length, music: files.music.length
  });

  const totals = { images: files.images.length, pdfs: files.pdfs.length, ppts: files.ppts.length, music: files.music.length };
  const total = totals.images + totals.pdfs + totals.ppts + totals.music;

  const counts = {
    total,
    processed: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    perDone: { images: 0, pdfs: 0, ppts: 0, music: 0 },
    perResult: {
      images: { inserted: 0, updated: 0, skipped: 0 },
      pdfs:   { inserted: 0, updated: 0, skipped: 0 },
      ppts:   { inserted: 0, updated: 0, skipped: 0 },
      music:  { inserted: 0, updated: 0, skipped: 0 }
    }
  };

  emitProgress({ phase: 'start', message: 'Import start', total, perTotals: totals });

  // liveness/ETA
  let tickTimer = setInterval(() => {
    try {
      const elapsedMs = Date.now() - currentJob.startedAt;
      const speed = elapsedMs > 0 ? counts.processed / (elapsedMs / 1000) : 0;
      const remaining = Math.max(0, counts.total - counts.processed);
      const etaSec = speed > 0 ? Math.ceil(remaining / speed) : null;

      const perTypeMetrics = {};
      for (const t of Object.keys(totals)) {
        const done = counts.perDone[t];
        const tot = totals[t];
        const rem = Math.max(0, tot - done);
        const etaT = speed > 0 ? Math.ceil(rem / speed) : null; // grovt – använder total speed
        perTypeMetrics[t] = {
          done, total: tot, percent: tot > 0 ? Math.floor((done / tot) * 100) : 100, etaSec: etaT
        };
      }

      emitProgress({
        phase: 'tick',
        processed: counts.processed,
        total: counts.total,
        metrics: {
          elapsedMs,
          speedPerSec: speed,
          etaSecOverall: etaSec,
          perType: perTypeMetrics
        },
        perDone: counts.perDone,
        perResult: counts.perResult
      });
    } catch {}
  }, 1000);

  /* -------------------- Robust upsert helpers (per typ) -------------------- */
  async function importImage(row) {
    const [erows] = await pool.query(
      `SELECT FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, Width, Height, CameraMake, CameraModel, Latitude, Longitude
       FROM sp_image WHERE Sha256=? LIMIT 1`, [row.sha]
    );
    if (erows.length) {
      const e = erows[0];
      const identical =
        same(e.FileName, row.fileName) &&
        same(e.FullPath, row.fullPath) &&
        same(e.SizeBytes, row.size) &&
        same(e.LastWriteTimeUtc, row.lastWrite) &&
        same(e.MimeType, row.mime) &&
        same(e.Width, row.width) &&
        same(e.Height, row.height) &&
        same(e.CameraMake, row.make) &&
        same(e.CameraModel, row.model) &&
        same(e.Latitude, row.latitude) &&
        same(e.Longitude, row.longitude);

      if (identical) return { result: 'skipped' };

      await pool.query(
        `UPDATE sp_image SET
           FileName=?, FullPath=?, SizeBytes=?, LastWriteTimeUtc=?, MimeType=?,
           Width=?, Height=?, CameraMake=?, CameraModel=?, Latitude=?, Longitude=?
         WHERE Sha256=?`,
        [row.fileName, row.fullPath, row.size, row.lastWrite, row.mime,
         row.width, row.height, row.make, row.model, row.latitude, row.longitude, row.sha]
      );
      return { result: 'updated' };
    }

    await pool.query(
      `INSERT INTO sp_image
         (Sha256, FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, Width, Height, CameraMake, CameraModel, Latitude, Longitude)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [row.sha, row.fileName, row.fullPath, row.size, row.lastWrite, row.mime, row.width, row.height, row.make, row.model, row.latitude, row.longitude, row.width, row.height]
    );
    return { result: 'inserted' };
  }

  async function importPdf(row) {
    const [erows] = await pool.query(
      `SELECT FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, PageCount
       FROM sp_pdf WHERE Sha256=? LIMIT 1`, [row.sha]
    );
    if (erows.length) {
      const e = erows[0];
      const identical =
        same(e.FileName, row.fileName) &&
        same(e.FullPath, row.fullPath) &&
        same(e.SizeBytes, row.size) &&
        same(e.LastWriteTimeUtc, row.lastWrite) &&
        same(e.MimeType, row.mime) &&
        same(e.PageCount, row.pageCount);

      if (identical) return { result: 'skipped' };

      await pool.query(
        `UPDATE sp_pdf SET
           FileName=?, FullPath=?, SizeBytes=?, LastWriteTimeUtc=?, MimeType=?, PageCount=?
         WHERE Sha256=?`,
        [row.fileName, row.fullPath, row.size, row.lastWrite, row.mime, row.pageCount, row.sha]
      );
      return { result: 'updated' };
    }

    await pool.query(
      `INSERT INTO sp_pdf
         (Sha256, FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, PageCount)
       VALUES (?,?,?,?,?,?,?)`,
      [row.sha, row.fileName, row.fullPath, row.size, row.lastWrite, row.mime, row.pageCount]
    );
    return { result: 'inserted' };
  }

  async function importPpt(row) {
    const [erows] = await pool.query(
      `SELECT FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, SlideCount
       FROM sp_ppt WHERE Sha256=? LIMIT 1`, [row.sha]
    );
    if (erows.length) {
      const e = erows[0];
      const identical =
        same(e.FileName, row.fileName) &&
        same(e.FullPath, row.fullPath) &&
        same(e.SizeBytes, row.size) &&
        same(e.LastWriteTimeUtc, row.lastWrite) &&
        same(e.MimeType, row.mime) &&
        same(e.SlideCount, row.slideCount);

      if (identical) return { result: 'skipped' };

      await pool.query(
        `UPDATE sp_ppt SET
           FileName=?, FullPath=?, SizeBytes=?, LastWriteTimeUtc=?, MimeType=?, SlideCount=?
         WHERE Sha256=?`,
        [row.fileName, row.fullPath, row.size, row.lastWrite, row.mime, row.slideCount, row.sha]
      );
      return { result: 'updated' };
    }

    await pool.query(
      `INSERT INTO sp_ppt
         (Sha256, FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, SlideCount)
       VALUES (?,?,?,?,?,?,?)`,
      [row.sha, row.fileName, row.fullPath, row.size, row.lastWrite, row.mime, row.slideCount]
    );
    return { result: 'inserted' };
  }

  async function importMusic(row) {
    const [erows] = await pool.query(
      `SELECT FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, Title, Artist, Album, DurationSeconds, BitrateKbps
       FROM sp_music WHERE Sha256=? LIMIT 1`, [row.sha]
    );
    if (erows.length) {
      const e = erows[0];
      const identical =
        same(e.FileName, row.fileName) &&
        same(e.FullPath, row.fullPath) &&
        same(e.SizeBytes, row.size) &&
        same(e.LastWriteTimeUtc, row.lastWrite) &&
        same(e.MimeType, row.mime) &&
        same(e.Title, row.title) &&
        same(e.Artist, row.artist) &&
        same(e.Album, row.album) &&
        same(e.DurationSeconds, row.duration) &&
        same(e.BitrateKbps, row.bitrate);

      if (identical) return { result: 'skipped' };

      await pool.query(
        `UPDATE sp_music SET
           FileName=?, FullPath=?, SizeBytes=?, LastWriteTimeUtc=?, MimeType=?,
           Title=?, Artist=?, Album=?, DurationSeconds=?, BitrateKbps=?
         WHERE Sha256=?`,
        [row.fileName, row.fullPath, row.size, row.lastWrite, row.mime,
         row.title, row.artist, row.album, row.duration, row.bitrate, row.sha]
      );
      return { result: 'updated' };
    }

    await pool.query(
      `INSERT INTO sp_music
         (Sha256, FileName, FullPath, SizeBytes, LastWriteTimeUtc, MimeType, Title, Artist, Album, DurationSeconds, BitrateKbps)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [row.sha, row.fileName, row.fullPath, row.size, row.lastWrite, row.mime,
       row.title, row.artist, row.album, row.duration, row.bitrate]
    );
    return { result: 'inserted' };
  }

  /* -------------------- Import per fil (använder helper ovan) -------------------- */
  async function importOneFile(type, fullPath) {
    const stat = await fs.promises.stat(fullPath);
    const row = {
      fileName: path.basename(fullPath),
      fullPath,
      size: stat.size,
      lastWrite: new Date(stat.mtimeMs).toISOString().slice(0, 19).replace('T', ' '),
      mime: detectMimeType(fullPath),
      sha: await sha256File(fullPath)
    };

    if (type === 'images') {
      const meta = await readImageMeta(fullPath).catch(() => ({}));
      if (meta?.dateTakenUtc) { row.lastWrite = meta.dateTakenUtc; }
      row.width = meta?.width ?? null;
      row.height = meta?.height ?? null;
      row.make = meta?.cameraMake ?? null;
      row.model = meta?.cameraModel ?? null;
      row.latitude = meta?.latitude ?? null;
      row.longitude = meta?.longitude ?? null;
      return importImage(row);
    }

    if (type === 'pdfs') {
      const meta = await readPdfMeta(fullPath).catch(() => ({}));
      row.pageCount = meta?.pageCount ?? null;
      return importPdf(row);
    }

    if (type === 'ppts') {
      const meta = await readPptMeta(fullPath).catch(() => ({}));
      row.slideCount = meta?.slideCount ?? null;
      return importPpt(row);
    }

    if (type === 'music') {
      const meta = await readAudioMeta(fullPath).catch(() => ({}));
      row.title = meta?.title ?? null;
      row.artist = meta?.artist ?? null;
      row.album = meta?.album ?? null;
      row.duration = meta?.durationSeconds ?? null;
      row.bitrate = meta?.bitrateKbps ?? null;
      return importMusic(row);
    }

    return { result: 'skipped' };
  }

  async function processList(type, list) {
    emitProgress({ phase: 'health', step: 'category:start', type, total: list.length });

    for (const full of list) {
      if (currentJob?.cancelled) {
        emitProgress({ phase: 'aborted', message: 'User aborted', summary: buildSummary() });
        return;
      }

      const nextIndex = counts.processed + 1;
      emitProgress({ phase: 'processing', type, file: full, index: nextIndex, total: counts.total });
      try {
        const info = await importOneFile(type, full);
        counts.processed += 1;
        counts.perDone[type] += 1;

        if (info?.result === 'inserted') { counts.inserted += 1; counts.perResult[type].inserted += 1; }
        else if (info?.result === 'skipped') { counts.skipped += 1; counts.perResult[type].skipped += 1; }
        else { counts.updated += 1; counts.perResult[type].updated += 1; }

        emitProgress({
          phase: 'processed',
          type,
          file: full,
          index: counts.processed,
          total: counts.total,
          inserted: counts.inserted,
          updated: counts.updated,
          skipped: counts.skipped,
          errors: counts.errors,
          perDone: counts.perDone,
          perResult: counts.perResult,
          perTotals: totals
        });
      } catch (e) {
        counts.processed += 1;
        counts.errors += 1;
        emitProgress({
          phase: 'error',
          type,
          file: full,
          index: counts.processed,
          total: counts.total,
          errors: counts.errors,
          message: (e && e.stack) ? e.stack : String(e),
        });
      }
    }
    emitProgress({ phase: 'health', step: 'category:done', type, perDone: counts.perDone });
  }

  function buildSummary() {
    const elapsedMs = Date.now() - currentJob.startedAt;
    const speed = elapsedMs > 0 ? counts.processed / (elapsedMs/1000) : 0;
    return {
      totalProcessed: counts.processed,
      totalInserted: counts.inserted,
      totalUpdated: counts.updated,
      totalSkipped: counts.skipped,
      errors: counts.errors,
      perDone: counts.perDone,
      perResult: counts.perResult,
      perTotals: totals,
      durationMs: elapsedMs,
      avgSpeedPerSec: speed
    };
  }

  try {
    await processList('images', files.images);
    if (!currentJob?.cancelled) await processList('pdfs',   files.pdfs);
    if (!currentJob?.cancelled) await processList('ppts',   files.ppts);
    if (!currentJob?.cancelled) await processList('music',  files.music);
  } catch (e) {
    emitProgress({ phase: 'fatal', message: String(e) });
  } finally {
    try { clearInterval(tickTimer); } catch {}
    try { await pool.end(); } catch {}
  }

  if (currentJob?.cancelled) {
    emitProgress({ phase: 'aborted', message: 'Aborted by user', summary: buildSummary() });
  } else {
    emitProgress({ phase: 'done', message: 'Import finished', summary: buildSummary() });
  }
  currentJob = null;
});
