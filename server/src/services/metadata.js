import mm from 'music-metadata';
import JSZip from 'jszip';

import fs from 'fs';
import { promisify } from 'util';
import exifr from 'exifr';
import imageSizeCb from 'image-size';
const imageSize = promisify(imageSizeCb);

// ---- Hjälpfunktioner ----
function dmsToDecimal(dms, ref) {
  if (!dms) return null;
  let deg, min, sec;
  if (Array.isArray(dms)) [deg, min, sec] = dms;
  else if (typeof dms === 'object') ({ degrees:deg, minutes:min, seconds:sec } = dms);
  else return null;
  if (deg == null) return null;
  const sign = (ref === 'S' || ref === 'W') ? -1 : 1;
  const val = sign * (Number(deg) + (Number(min)||0)/60 + (Number(sec)||0)/3600);
  return isFinite(val) ? val : null;
}
function firstStringByKeys(obj, keys) {
  for (const k of keys) if (obj[k] != null) return String(obj[k]);
  return null;
}
function probeStringByIncludes(obj, needle) {
  const low = needle.toLowerCase();
  for (const k of Object.keys(obj||{})) {
    if (k.toLowerCase().includes(low) && obj[k] != null && typeof obj[k] !== 'object') {
      return String(obj[k]);
    }
  }
  return null;
}
function probeLatLon(obj) {
  const latKeys = ['latitude','Latitude','GPSLatitude','gpsLatitude','XMP:GPSLatitude','tiff:GPSLatitude'];
  const lonKeys = ['longitude','Longitude','GPSLongitude','gpsLongitude','XMP:GPSLongitude','tiff:GPSLongitude'];
  let lat = null, lon = null;
  for (const k of latKeys) if (obj[k] != null && isFinite(Number(obj[k]))) { lat = Number(obj[k]); break; }
  for (const k of lonKeys) if (obj[k] != null && isFinite(Number(obj[k]))) { lon = Number(obj[k]); break; }
  if (lat != null && lon != null) return { lat, lon };
  const latD = obj.GPSLatitude || obj.gps?.GPSLatitude;
  const lonD = obj.GPSLongitude || obj.gps?.GPSLongitude;
  const latRef = obj.GPSLatitudeRef || obj.gps?.GPSLatitudeRef;
  const lonRef = obj.GPSLongitudeRef || obj.gps?.GPSLongitudeRef;
  if (latD && lonD) {
    const lat2 = dmsToDecimal(latD, latRef);
    const lon2 = dmsToDecimal(lonD, lonRef);
    if (lat2 != null && lon2 != null) return { lat: lat2, lon: lon2 };
  }
  let candLat = null, candLon = null;
  for (const k of Object.keys(obj||{})) {
    const lk = k.toLowerCase();
    if (candLat == null && lk.includes('lat') && isFinite(Number(obj[k]))) candLat = Number(obj[k]);
    if (candLon == null && lk.includes('lon') && isFinite(Number(obj[k]))) candLon = Number(obj[k]);
  }
  if (candLat != null && candLon != null) return { lat: candLat, lon: candLon };
  return { lat: null, lon: null };
}

// ---- Images ----
export async function readImageMeta(fullPath) {
  const out = { width:null, height:null, cameraMake:null, cameraModel:null, latitude:null, longitude:null, dateTakenUtc:null, _source:[] };
  try {
    const dim = await imageSize(fullPath);
    if (dim?.width && dim?.height) {
      out.width = Number(dim.width);
      out.height = Number(dim.height);
      out._source.push('size');
    }
  } catch {}
  let exif = null;
  try { exif = await exifr.parse(fullPath, { exif:true, gps:true, tiff:true }); } catch {}
  if (exif) {
    const make = exif.Make || exif.make;
    const model = exif.Model || exif.model;
    const { lat, lon } = probeLatLon(exif);
    if (make) { out.cameraMake = String(make).trim(); out._source.push('exif.make'); }
    if (model) { out.cameraModel = String(model).trim(); out._source.push('exif.model'); }
    if (lat != null && lon != null) { out.latitude = lat; out.longitude = lon; out._source.push('exif.gps'); }

    // Date Taken: prefer EXIF DateTimeOriginal / CreateDate
    const dt = exif.DateTimeOriginal || exif.CreateDate || exif.DateCreated || exif.ModifyDate;
    if (dt instanceof Date && !isNaN(dt)) {
      // normalize to UTC 'YYYY-MM-DD HH:mm:ss'
      out.dateTakenUtc = new Date(dt).toISOString().slice(0,19).replace('T',' ');
      out._source.push('exif.date');
    } else if (typeof dt === 'string') {
      const parsed = new Date(dt);
      if (!isNaN(parsed)) {
        out.dateTakenUtc = parsed.toISOString().slice(0,19).replace('T',' ');
        out._source.push('exif.date');
      }
    }

  }
  if (!out.cameraMake || !out.cameraModel || out.latitude == null || out.longitude == null) {
    try {
      const meta = await exifr.parse(fullPath, { xmp:true, iptc:true, gps:true, exif:true, tiff:true });
      if (meta && typeof meta === 'object') {
        if (!out.cameraMake) {
          out.cameraMake = firstStringByKeys(meta, ['tiff:Make','XMP:Make','Make','make']) || probeStringByIncludes(meta,'make');
          if (out.cameraMake) { out.cameraMake = out.cameraMake.trim(); out._source.push('xmp/iptc.make'); }
        }
        if (!out.cameraModel) {
          out.cameraModel = firstStringByKeys(meta, ['tiff:Model','XMP:Model','Model','model']) || probeStringByIncludes(meta,'model');
          if (out.cameraModel) { out.cameraModel = out.cameraModel.trim(); out._source.push('xmp/iptc.model'); }
        }

        // Date Taken from XMP/IPTC if available
        if (!out.dateTakenUtc) {
          const dtKeys = ['xmp:CreateDate','xmp:DateCreated','CreateDate','DateCreated','photoshop:DateCreated'];
          for (const k of dtKeys) {
            if (meta[k]) {
              const d = new Date(meta[k]);
              if (!isNaN(d)) {
                out.dateTakenUtc = d.toISOString().slice(0,19).replace('T',' ');
                out._source.push('xmp/iptc.date');
                break;
              }
            }
          }
        }

        if (out.latitude == null || out.longitude == null) {
          const { lat, lon } = probeLatLon(meta);
          if (lat != null && lon != null) { out.latitude = lat; out.longitude = lon; out._source.push('xmp/iptc.gps'); }
        }
      }
    } catch {}
  }
  return out;
}

// ---- PDFs ----
export async function readPdfMeta(fullPath) {
  const __oldWarn = console.warn;
  try {
    console.warn = function(){ /* muted pdf warnings */ };
    try {
      const { default: pdfParse } = await import('pdf-parse');
      const buf = await fs.promises.readFile(fullPath);
      const pdf = await pdfParse(buf);
      return { pageCount: pdf.numpages || null };
    } catch {}
    try {
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.js');
      const { getDocument } = pdfjsLib;
      const loadingTask = getDocument(fullPath);
      const doc = await loadingTask.promise;
      const num = doc.numPages || null;
      try { await doc.destroy(); } catch {}
      return { pageCount: num };
    } catch {}
    return { pageCount: null };
  } finally {
    console.warn = __oldWarn;
  }
}

// ---- PPTs ----
export async function readPptMeta(fullPath) {
  try {
  
    const ext = (fullPath.split('.').pop() || '').toLowerCase();
    if (ext === 'pptx') {
      const buf = await fs.promises.readFile(fullPath);
      const zip = await JSZip.loadAsync(buf);
 
      let count = 0;
      zip.forEach((relPath, file) => {
        const p = relPath.replace(/\\/g,'/').toLowerCase();
        if (p.startsWith('ppt/slides/') && p.endsWith('.xml') && /\/slide\d+\.xml$/.test(p)) {
          count++;
        }
      });
      return { slideCount: count || null };
    }

    return { slideCount: null };
  } catch {
    return { slideCount: null };
  }
}

// ---- Music ----
export async function readAudioMeta(fullPath) {
  try {

    const meta = await mm.parseFile(fullPath, { duration: true, skipCovers: true });
    const c = meta.common || {};
    const title  = c.title  ? String(c.title).trim()  : null;
    const artist = c.artist ? String(c.artist).trim() : null;
    const album  = c.album  ? String(c.album).trim()  : null;

    let durationSeconds = null;
    if (meta.format && Number.isFinite(meta.format.duration)) {
      durationSeconds = Math.round(meta.format.duration);
    }

    let bitrateKbps = null;
    if (meta.format && Number.isFinite(meta.format.bitrate)) {
      bitrateKbps = Math.round(meta.format.bitrate / 1000);
    }

    return { title, artist, album, durationSeconds, bitrateKbps };
  } catch {
    return { title: null, artist: null, album: null, durationSeconds: null, bitrateKbps: null };
  }
}
