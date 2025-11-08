import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');

function absOrResolve(p) {
  if (!p) return null;
  return path.isAbsolute(p) ? p : path.resolve(root, p);
}

export const config = {
  mysql: {
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    multipleStatements: true
  },
  dirs: {
    base: absOrResolve(process.env.BASE_DIR || '../meta_files'),
    image: absOrResolve(process.env.IMAGE_DIR || '../meta_files/image'),
    pdf:   absOrResolve(process.env.PDF_DIR   || '../meta_files/pdf'),
    ppt:   absOrResolve(process.env.PPT_DIR   || '../meta_files/ppt'),
    music: absOrResolve(process.env.MUSIC_DIR || '../meta_files/music')
  },
  server: { port: Number(process.env.PORT || 3000) },
  auth: { user: process.env.BASIC_USER || '', pass: process.env.BASIC_PASS || '' },
  root
};
