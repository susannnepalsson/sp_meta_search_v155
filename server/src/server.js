import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import basicAuth from 'express-basic-auth';

import { config } from './config.js';
import { ensureSchema, getPool } from './db.js';
import { importRouter } from './routes/import.js';
import { uploadRouter } from './routes/upload.js';
import { searchRouter } from './routes/search.js';
import { debugRouter } from './routes/debug.js';
import { debugAudioRouter } from './routes/debug-audio.js';

import { dbCheckRouter } from './routes/dbcheck.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

for (const d of Object.values(config.dirs)) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

// frontend
app.use(express.static(
  path.resolve(__dirname, '..', '..', 'public'),
  { index: 'search.html' }    // Öpnna search.html vid start
));

// static files exposure
app.use('/files', express.static(config.dirs.base, { fallthrough: true }));

const useAuth = config.auth.user && config.auth.pass;
const protect = useAuth ? basicAuth({ users: { [config.auth.user]: config.auth.pass }, challenge: true }) : (_req,_res,next)=>next();

app.use('/api/import', protect, importRouter);
app.use('/api/upload', protect, uploadRouter);
app.use('/api/search', searchRouter);
app.use('/api/debug', protect, debugRouter);
app.use('/api/debug', protect, debugAudioRouter);
app.use('/api/debug', protect, dbCheckRouter);


// Ensure default page is search.html
app.get('/', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'search.html'));
});

app.get('/api/health', (_req,res)=>res.json({status:'ok'}));
// DB health check: simple ping
app.get('/api/health/db', async (_req,res)=>{
  try {
    const pool = await getPool();
    const [rows] = await pool.query('SELECT 1 AS ok');
    res.json({ status:'ok', db:true, result: rows && rows[0] });
  } catch (e) {
    res.status(500).json({ status:'error', db:false, error: String(e) });
  }
});


ensureSchema().then(()=>{
  app.listen(config.server.port, ()=>{
    console.log(`sp_meta_search_js v3 listening on http://localhost:${config.server.port}`);
  });
}).catch(err=>{ console.error('Failed to init schema', err); process.exit(1); });
