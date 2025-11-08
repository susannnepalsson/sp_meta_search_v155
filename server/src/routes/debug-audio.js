// server/src/routes/debug-audio.js
import { Router } from 'express';
import fs from 'fs';
import { readAudioMeta } from '../services/metadata.js';

export const debugAudioRouter = Router();

/**
 * GET /api/debug/audio?path=C:/path/to/file.mp3
 * OBS: På Windows – använd framåtsnash (/) i URL, eller URL-encoda backslash.
 */
debugAudioRouter.get('/audio', async (req, res) => {
  try {
    const p = req.query.path;
    if (!p) return res.status(400).json({ ok: false, error: 'Missing ?path=' });

    // Tillåt både C:\... och C:/...
    const pathStr = String(p);
    if (!fs.existsSync(pathStr)) {
      return res.status(404).json({ ok: false, error: 'File not found', path: pathStr });
    }

    const meta = await readAudioMeta(pathStr);
    return res.json({ ok: true, path: pathStr, meta });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});
