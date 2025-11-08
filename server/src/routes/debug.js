import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const debugRouter = Router();

debugRouter.get('/scan', async (_req, res) => {
  const dirs = config.dirs;
  const list = (dir) => fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isFile())
        .map(e => path.join(dir, e.name))
    : [];
  res.json({
    dirs,
    exists: { base: fs.existsSync(dirs.base), image: fs.existsSync(dirs.image), pdf: fs.existsSync(dirs.pdf), ppt: fs.existsSync(dirs.ppt), music: fs.existsSync(dirs.music) },
    files: { image: list(dirs.image), pdf: list(dirs.pdf), ppt: list(dirs.ppt), music: list(dirs.music) }
  });
});
