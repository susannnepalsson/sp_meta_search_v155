function attachFileUrl(rows) {
  try {
    const base = (config && config.dirs && config.dirs.base) ? String(config.dirs.base).replace(/\\/g,'/') : '';
    const baseLow = base.toLowerCase();
    for (const r of rows || []) {
      if (!r || !r.FullPath) continue;
      let p = String(r.FullPath).replace(/\\/g,'/');
      const plow = p.toLowerCase();
      if (base && plow.startsWith(baseLow)) {
        let rel = p.slice(base.length);
        if (rel.startsWith('/')) rel = rel.slice(1);
        r.FileUrl = '/files/' + rel;
      } else {
        r.FileUrl = null;
      }
    }
  } catch {}
  return rows;
}
import { config } from '../config.js';

import { Router } from 'express';
import { getPool } from '../db.js';

export const searchRouter = Router();

function sanitizeSort(sort) {
  const allowed = new Set(['Id','FileName','SizeBytes','LastWriteTimeUtc']);
  return allowed.has(sort) ? sort : 'Id';
}
function sanitizeDir(dir) { return (dir && dir.toLowerCase()==='asc') ? 'ASC' : 'DESC'; }

searchRouter.get('/', async (req, res) => {
  const pool = await getPool();
  const domain = (req.query.domain || '').toString().toLowerCase();
  const page = Math.max(parseInt(req.query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize || '50', 10), 1), 500);
  const sort = sanitizeSort((req.query.sort || 'Id').toString());
  const dir = sanitizeDir((req.query.dir || 'DESC').toString());

  const fileName = (req.query.fileName || '').toString();
  const dateFrom = (req.query.dateFrom || '').toString();
  const dateTo = (req.query.dateTo || '').toString();
  const title = (req.query.title || '').toString();
  const artist = (req.query.artist || '').toString();
  const album = (req.query.album || '').toString();
  const cameraMake = (req.query.cameraMake || '').toString();
  const cameraModel = (req.query.cameraModel || '').toString();

  const offset = (page - 1) * pageSize;

  async function query(table, whereParts, args) {
    const where = whereParts.length ? ('WHERE ' + whereParts.join(' AND ')) : '';
    const sql = `SELECT SQL_CALC_FOUND_ROWS * FROM ${table} ${where} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`;
    const [rows] = await pool.query(sql, [...args, pageSize, offset]);
    const [tot] = await pool.query('SELECT FOUND_ROWS() AS total');
    return { items: rows, total: tot[0]?.total ?? rows.length };
  }

  const filtersCommon = [];
  const argsCommon = [];
  if (fileName) { filtersCommon.push('FileName LIKE ?'); argsCommon.push(`%${fileName}%`); }
  if (dateFrom) { filtersCommon.push('LastWriteTimeUtc >= ?'); argsCommon.push(`${dateFrom} 00:00:00`); }
  if (dateTo)   { filtersCommon.push('LastWriteTimeUtc <= ?'); argsCommon.push(`${dateTo} 23:59:59`); }

  const result = {};
  const domains = (!domain || domain==='') ? ['image','pdf','ppt','music'] : [domain];

  for (const d of domains) {
    if (d === 'image') {
      const parts = [...filtersCommon];
      const args = [...argsCommon];
      if (cameraMake) { parts.push('IFNULL(CameraMake,"") LIKE ?'); args.push(`%${cameraMake}%`); }
      if (cameraModel){ parts.push('IFNULL(CameraModel,"") LIKE ?'); args.push(`%${cameraModel}%`); }
      result.images = await query('sp_image', parts, args);
    } else if (d === 'pdf') {
      result.pdfs = await query('sp_pdf', [...filtersCommon], [...argsCommon]);
    } else if (d === 'ppt') {
      result.ppts = await query('sp_ppt', [...filtersCommon], [...argsCommon]);
    } else if (d === 'music') {
      const parts = [...filtersCommon];
      const args = [...argsCommon];
      if (title)  { parts.push('IFNULL(Title,"") LIKE ?');  args.push(`%${title}%`); }
      if (artist) { parts.push('IFNULL(Artist,"") LIKE ?'); args.push(`%${artist}%`); }
      if (album)  { parts.push('IFNULL(Album,"") LIKE ?');  args.push(`%${album}%`); }
      result.music = await query('sp_music', parts, args);
    }
  }

  await pool.end();
  res.json(result);
});
