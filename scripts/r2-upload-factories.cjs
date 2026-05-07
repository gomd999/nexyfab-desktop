#!/usr/bin/env node
/**
 * Upload data/factories-import.db to R2 bucket so Railway can fetch it.
 * Reads S3_* env vars (same ones NexyFab already uses).
 */
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const required = ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_ENDPOINT', 'S3_BUCKET'];
for (const k of required) {
  if (!process.env[k]) {
    console.error(`missing env: ${k}`);
    process.exit(1);
  }
}

const SRC = path.join(__dirname, '..', 'data', 'factories-import.db');
const KEY = 'imports/factories-import.db';

(async () => {
  const body = fs.readFileSync(SRC);
  console.log(`read ${(body.length / 1024 / 1024).toFixed(1)} MB from ${SRC}`);

  const s3 = new S3Client({
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  });

  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: KEY,
    Body: body,
    ContentType: 'application/x-sqlite3',
  }));
  console.log(`uploaded → s3://${process.env.S3_BUCKET}/${KEY}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
