/**
 * drawingInput.test.ts — **도면·이미지 입력의 단일 소스** (260803).
 *
 * ## 왜
 * `image/png,image/jpeg,image/webp` 가 **여섯 곳**에 각각 적혀 있었다
 * (extract · extract-preset · intent-from-image 라우트 3 + accept 속성 2 + 클라 정규식 1).
 * 붙여넣기·드래그를 더하면 여덟 곳이 된다. 이 세션에 **같은 단일소스 결손으로 여섯 번
 * 틀렸다**(enum 9종 · PART_PARAMS · TYPE_HINTS · description · 라우트 어휘 · params 63키).
 * 입력 타입에서 일곱 번째를 만들지 않는다.
 *
 * ⚠ 이 파일은 **소스를 읽어 하드코딩을 잡는다.** 함수 단위 검사만 하면
 *   「모듈은 맞는데 아무도 안 쓰는」 상태를 못 잡는다 — 이 세션의 그 형태다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCEPT_RASTER, GRADE_NOTE, MAX_IMAGE_BYTES, RASTER_MIME,
  gradeOf, imageFromTransfer, isAcceptedRaster,
} from './drawingInput';

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('★① 허용 타입이 한 곳에서만 정의된다', () => {
  const FILES = [
    ['src', 'app', 'api', 'nexyfab', 'drawing', 'extract', 'route.ts'],
    ['src', 'app', 'api', 'nexyfab', 'drawing', 'extract-preset', 'route.ts'],
    ['src', 'app', 'api', 'nexyfab', 'intent-from-image', 'route.ts'],
    ['src', 'app', '[lang]', 'ChatHero.tsx'],
    ['src', 'app', '[lang]', 'nexyfab', 'design', 'AssemblyPresetPanel.tsx'],
  ];

  it('★도면 입력 경로에 MIME 목록이 다시 박혀 있지 않다', () => {
    const bad: string[] = [];
    for (const p of FILES) {
      const src = read(...p);
      if (/'image\/png',\s*'image\/jpeg'/.test(src) || /accept="image\/png,image\/jpeg/.test(src)) bad.push(p.join('/'));
    }
    expect(bad, `단일 소스를 안 쓰는 곳: ${bad.join(', ')}`).toEqual([]);
  });

  it('전부 @/lib/drawingInput 을 불러 쓴다', () => {
    for (const p of FILES) expect(read(...p), p.join('/')).toContain('@/lib/drawingInput');
  });

  it('accept 문자열이 RASTER_MIME 에서 나온다', () => {
    expect(ACCEPT_RASTER).toBe(RASTER_MIME.join(','));
  });
});

describe('★② 붙여넣기·드래그가 파일선택과 같은 판정을 쓴다', () => {
  const mk = (type: string, size = 1000) => ({ type, size, name: 'x' }) as unknown as File;

  it('허용 타입은 통과', () => {
    for (const m of RASTER_MIME) expect(isAcceptedRaster(mk(m)).ok).toBe(true);
  });

  it('★거부 사유를 구별한다 — 「안 됩니다」만으로는 무엇을 고칠지 모른다', () => {
    expect(isAcceptedRaster(mk('image/gif'))).toEqual({ ok: false, reason: 'type' });
    expect(isAcceptedRaster(mk('image/png', MAX_IMAGE_BYTES + 1))).toEqual({ ok: false, reason: 'size' });
  });

  it('★붙여넣기(items)와 드래그(files) 둘 다 읽는다 — 한쪽만 보면 절반이 안 된다', () => {
    const file = mk('image/png');
    const asItems = { files: [], items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } as unknown as DataTransfer;
    const asFiles = { files: [file], items: [] } as unknown as DataTransfer;
    expect(imageFromTransfer(asItems)).toBe(file);
    expect(imageFromTransfer(asFiles)).toBe(file);
  });

  it('이미지가 아니면 null — 텍스트 붙여넣기를 가로채지 않는다', () => {
    const dt = { files: [], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } as unknown as DataTransfer;
    expect(imageFromTransfer(dt)).toBeNull();
    expect(imageFromTransfer(null)).toBeNull();
  });

  it('★ChatHero 가 세 경로를 다 배선했다 — 모듈만 있고 안 쓰면 무효다', () => {
    const ui = read('src', 'app', '[lang]', 'ChatHero.tsx');
    expect(ui, '붙여넣기 미배선').toMatch(/onPaste=\{onPasteImage\}/);
    expect(ui, '드롭 미배선').toMatch(/onDrop=\{onDropImage\}/);
    expect(ui, '드래그 중 표시 없음 — 반응이 없으면 안 되는 줄 안다').toMatch(/dragOver/);
  });
});

describe('★③ 입력 등급 — 엔진이 정한다', () => {
  it('STEP/STL 은 model, DXF·PDF·SVG 는 vector, 사진은 raster', () => {
    expect(gradeOf({ name: 'a.step' })).toBe('model');
    expect(gradeOf({ name: 'a.STL' })).toBe('model');
    expect(gradeOf({ name: 'a.dxf' })).toBe('vector');
    expect(gradeOf({ name: 'a.pdf', type: 'application/pdf' })).toBe('vector');
    expect(gradeOf({ name: 'a.png', type: 'image/png' })).toBe('raster');
    expect(gradeOf({ name: 'a.txt', type: 'text/plain' })).toBe('text');
  });

  it('★등급마다 「무엇이 보장되는가」를 6언어 중 최소 ko·en 으로 말한다', () => {
    for (const g of ['model', 'vector', 'raster', 'text'] as const) {
      expect(GRADE_NOTE[g].ko, g).toBeTruthy();
      expect(GRADE_NOTE[g].en, g).toBeTruthy();
    }
  });

  it('★래스터 안내는 「치수는 글로」를 말한다 — 사진에는 치수가 없다', () => {
    expect(GRADE_NOTE.raster.ko).toMatch(/치수는 글로/);
  });
});
