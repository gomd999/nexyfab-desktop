#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const SRC = path.join(__dirname, 'r2-download-and-merge-factories.cjs');
const KEY = 'imports/merge-factories.cjs';

(async () => {
  const body = fs.readFileSync(SRC);
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
    ContentType: 'application/javascript',
  }));
  console.log(`uploaded → s3://${process.env.S3_BUCKET}/${KEY} (${body.length} bytes)`);
})().catch((e) => { console.error(e); process.exit(1); });
