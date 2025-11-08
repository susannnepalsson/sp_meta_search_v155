import { Router } from 'express';
import fileUpload from 'express-fileupload';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getPool } from '../db.js';
import { sha256File } from '../services/hash.js';
import { readImageMeta, readPdfMeta, readPptMeta, readAudioMeta } from '../services/metadata.js';

export const uploadRouter = Router();
uploadRouter.use(fileUpload({ createParentPath: true, limits: { fileSize: 1024*1024*1024 } }));

function targetDir(type) { const map = { image: config.dirs.image, pdf: config.dirs.pdf, ppt: config.dirs.ppt, music: config.dirs.music }; return map[type] || config.dirs.base; }

async function importSaved(pool, type, dest) {
  const stat = fs.statSync(dest);
  const sha = await sha256File(dest);
  if (type === 'image') {
    const meta = await readImageMeta(dest);
    await pool.query(`INSERT IGNORE INTO sp_image (FileName, FullPath, MimeType, SizeBytes, LastWriteTimeUtc, Sha256, PixelWidth, PixelHeight, Latitude, Longitude, CameraMake, CameraModel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [path.basename(dest), path.resolve(dest), 'image/' + path.extname(dest).substring(1).toLowerCase(), stat.size, new Date(stat.mtime), sha, meta.width, meta.height, meta.lat, meta.lon, meta.make, meta.model]);
  } else if (type === 'pdf') {
    const meta = await readPdfMeta(dest);
    await pool.query(`INSERT IGNORE INTO sp_pdf (FileName, FullPath, MimeType, SizeBytes, LastWriteTimeUtc, Sha256, PageCount) VALUES (?,?,?,?,?,?,?)`,
      [path.basename(dest), path.resolve(dest), 'application/pdf', stat.size, new Date(stat.mtime), sha, meta.pages]);
  } else if (type === 'ppt') {
    const meta = await readPptMeta(dest);
    const ext = path.extname(dest).toLowerCase();
    const mime = ext === '.ppt' || ext === '.pps' ? 'application/vnd.ms-powerpoint' : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    await pool.query(`INSERT IGNORE INTO sp_ppt (FileName, FullPath, MimeType, SizeBytes, LastWriteTimeUtc, Sha256, SlideCount) VALUES (?,?,?,?,?,?,?)`,
      [path.basename(dest), path.resolve(dest), mime, stat.size, new Date(stat.mtime), sha, meta.slides]);
  } else if (type === 'music') {
    const meta = await readAudioMeta(dest);
    await pool.query(`INSERT IGNORE INTO sp_music (FileName, FullPath, MimeType, SizeBytes, LastWriteTimeUtc, Sha256, BitrateKbps, DurationSeconds, Title, Artist, Album) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [path.basename(dest), path.resolve(dest), 'audio/mpeg', stat.size, new Date(stat.mtime), sha, meta.bitrate, meta.duration, meta.title, meta.artist, meta.album]);
  }
}

uploadRouter.post('/', async (req, res) => {
  try {
    const type = (req.body?.type || '').toLowerCase();
    const dir = targetDir(type);
    fs.mkdirSync(dir, { recursive: true });
    const pool = await getPool();

    const files = req.files?.file;
    const arr = Array.isArray(files) ? files : (files ? [files] : []);
    if (!arr.length) return res.status(400).json({error:'No files'});

    const saved = [];
    for (const f of arr) {
      const dest = path.join(dir, path.basename(f.name));
      await f.mv(dest);
      await importSaved(pool, type, dest);
      saved.push(dest);
    }
    await pool.end();
    res.json({ saved, count: saved.length });
  } catch (e) { console.error(e); res.status(500).json({error:String(e)}); }
});
