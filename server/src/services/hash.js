import crypto from 'crypto';
import fs from 'fs';
export function sha256File(path) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(path);
  return new Promise((resolve, reject) => {
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}
