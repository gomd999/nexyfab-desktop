#!/usr/bin/env node
/**
 * CI/릴리스: TAURI_UPDATER_PUBKEY 가 있으면 src-tauri/updater.merge.json 생성 후
 * `tauri build --config updater.merge.json` 과 함께 쓰면 자동 업데이트 활성화.
 * 로컬 개발에서는 생략 가능(기본 tauri.conf.json은 updater.active=false).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mergePath = path.join(root, 'src-tauri', 'updater.merge.json');

const pubkey = process.env.TAURI_UPDATER_PUBKEY?.trim();

if (!pubkey) {
  if (fs.existsSync(mergePath)) {
    fs.unlinkSync(mergePath);
    console.log('[tauri-updater-merge] removed updater.merge.json (no TAURI_UPDATER_PUBKEY)');
  } else {
    console.log('[tauri-updater-merge] skip: TAURI_UPDATER_PUBKEY not set');
  }
  process.exit(0);
}

const merge = {
  plugins: {
    updater: {
      active: true,
      pubkey,
    },
  },
};

fs.writeFileSync(mergePath, JSON.stringify(merge, null, 2), 'utf-8');
console.log('[tauri-updater-merge] wrote src-tauri/updater.merge.json (updater active)');
