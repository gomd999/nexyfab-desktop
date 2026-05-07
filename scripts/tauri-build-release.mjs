#!/usr/bin/env node
/**
 * 1) tauri-updater-merge.mjs 로 updater.merge.json 생성(선택)
 * 2) 파일이 있으면 --config 로 Tauri 빌드(자동 업데이트 켜짐)
 */
import './load-parent-env.mjs';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mergePath = path.join(root, 'src-tauri', 'updater.merge.json');

execSync('node scripts/tauri-updater-merge.mjs', { cwd: root, stdio: 'inherit' });

let cmd = 'npx tauri build';
if (fs.existsSync(mergePath)) {
  cmd += ' --config src-tauri/updater.merge.json';
  console.log('[tauri-build-release] using updater.merge.json');
} else {
  console.log('[tauri-build-release] no updater.merge.json — building with default tauri.conf (updater inactive)');
}

execSync(cmd, { cwd: root, stdio: 'inherit', shell: true });
