import mysql from 'mysql2/promise';
import { config } from './config.js';

export async function getPool() { return mysql.createPool(config.mysql); }

export async function ensureSchema() {
  const pool = await getPool();
  const sql = `
CREATE TABLE IF NOT EXISTS sp_image (
  Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  FileName VARCHAR(512) NOT NULL,
  FullPath VARCHAR(2048) NOT NULL,
  MimeType VARCHAR(128) NOT NULL,
  SizeBytes BIGINT NOT NULL,
  LastWriteTimeUtc DATETIME NOT NULL,
  Sha256 VARCHAR(64) NOT NULL,
  Width INT NULL,
  Height INT NULL,
  Latitude DOUBLE NULL,
  Longitude DOUBLE NULL,
  CameraMake VARCHAR(128) NULL,
  CameraModel VARCHAR(128) NULL,
  UNIQUE KEY UX_sp_image_sha (Sha256),
  KEY IX_sp_image_file (FileName)
);
CREATE TABLE IF NOT EXISTS sp_pdf (
  Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  FileName VARCHAR(512) NOT NULL,
  FullPath VARCHAR(2048) NOT NULL,
  MimeType VARCHAR(128) NOT NULL,
  SizeBytes BIGINT NOT NULL,
  LastWriteTimeUtc DATETIME NOT NULL,
  Sha256 VARCHAR(64) NOT NULL,
  PageCount INT NULL,
  UNIQUE KEY UX_sp_pdf_sha (Sha256),
  KEY IX_sp_pdf_file (FileName)
);
CREATE TABLE IF NOT EXISTS sp_ppt (
  Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  FileName VARCHAR(512) NOT NULL,
  FullPath VARCHAR(2048) NOT NULL,
  MimeType VARCHAR(128) NOT NULL,
  SizeBytes BIGINT NOT NULL,
  LastWriteTimeUtc DATETIME NOT NULL,
  Sha256 VARCHAR(64) NOT NULL,
  SlideCount INT NULL,
  UNIQUE KEY UX_sp_ppt_sha (Sha256),
  KEY IX_sp_ppt_file (FileName)
);
CREATE TABLE IF NOT EXISTS sp_music (
  Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  FileName VARCHAR(512) NOT NULL,
  FullPath VARCHAR(2048) NOT NULL,
  MimeType VARCHAR(128) NOT NULL,
  SizeBytes BIGINT NOT NULL,
  LastWriteTimeUtc DATETIME NOT NULL,
  Sha256 VARCHAR(64) NOT NULL,
  BitrateKbps INT NULL,
  DurationSeconds INT NULL,
  Title VARCHAR(256) NULL,
  Artist VARCHAR(256) NULL,
  Album VARCHAR(256) NULL,
  UNIQUE KEY UX_sp_music_sha (Sha256),
  KEY IX_sp_music_file (FileName)
);`;
  await pool.query(sql);
  await pool.end();
}
