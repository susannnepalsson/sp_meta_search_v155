import { Router } from 'express';
import { getPool } from '../db.js';

export const dbCheckRouter = Router();

// GET /api/debug/dbcheck -> { ok: true, multipleStatements: true/false, details }
dbCheckRouter.get('/dbcheck', async (_req, res) => {
  try {
    const pool = await getPool();
    let multiOk = false;
    let details = {};
    try {
      const [results] = await pool.query('SELECT 1 AS a; SELECT 2 AS b;');
      multiOk = Array.isArray(results) && results.length >= 2;
      details = { sets: Array.isArray(results) ? results.length : null };
    } catch (e) {
      details = { error: String(e) };
    }
    return res.json({ ok: true, multipleStatements: !!multiOk, details });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e) });
  }
});
