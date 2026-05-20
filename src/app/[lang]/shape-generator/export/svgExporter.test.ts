import { describe, it, expect } from 'vitest';
import {
  writeSvg,
  emptyDocument,
  addLayer,
  fitDocumentToContent,
  summarize,
  type SvgDocument,
} from './svgExporter';

function sampleDoc(): SvgDocument {
  const doc = emptyDocument(100, 100);
  const layer = addLayer(doc, 'main');
  layer.primitives.push({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 50, y: 50 }, style: { stroke: '#000' } });
  layer.primitives.push({ kind: 'rect', x: 10, y: 10, width: 30, height: 20, style: { stroke: '#f00', fill: 'none' } });
  layer.primitives.push({ kind: 'circle', cx: 70, cy: 50, r: 10, style: { fill: '#0f0' } });
  return doc;
}

describe('writeSvg — structure', () => {
  it('includes XML declaration', () => {
    expect(writeSvg(sampleDoc())).toContain('<?xml version="1.0"');
  });

  it('contains svg root with viewBox', () => {
    const xml = writeSvg(sampleDoc());
    expect(xml).toContain('<svg');
    expect(xml).toContain('viewBox=');
  });

  it('renders each primitive', () => {
    const xml = writeSvg(sampleDoc());
    expect(xml).toContain('<line');
    expect(xml).toContain('<rect');
    expect(xml).toContain('<circle');
  });

  it('hidden layer skipped', () => {
    const doc = emptyDocument(100, 100);
    const layer = addLayer(doc, 'hidden');
    layer.visible = false;
    layer.primitives.push({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 1, y: 1 } });
    expect(writeSvg(doc)).not.toContain('<line');
  });

  it('title is emitted', () => {
    const doc = emptyDocument(100, 100);
    doc.title = 'My Drawing';
    expect(writeSvg(doc)).toContain('<title>My Drawing</title>');
  });

  it('escapes XML in title', () => {
    const doc = emptyDocument(100, 100);
    doc.title = '<bad> & "stuff"';
    expect(writeSvg(doc)).toContain('&lt;bad&gt; &amp; &quot;stuff&quot;');
  });

  it('y-axis up adds transform', () => {
    const doc: SvgDocument = { ...emptyDocument(100, 100), yAxisDirection: 'up' };
    expect(writeSvg(doc)).toContain('scale(1, -1)');
  });
});

describe('writeSvg — styles', () => {
  it('stroke + fill emitted on line', () => {
    const doc = emptyDocument(10, 10);
    const layer = addLayer(doc, 'a');
    layer.primitives.push({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, style: { stroke: 'blue', strokeWidth: 2 } });
    const xml = writeSvg(doc);
    expect(xml).toContain('stroke="blue"');
    expect(xml).toContain('stroke-width="2"');
  });

  it('dasharray included', () => {
    const doc = emptyDocument(10, 10);
    const layer = addLayer(doc, 'a');
    layer.primitives.push({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 5, y: 5 }, style: { strokeDasharray: [4, 2] } });
    expect(writeSvg(doc)).toContain('stroke-dasharray="4,2"');
  });
});

describe('writeSvg — primitives', () => {
  it('arc emits path with A command', () => {
    const doc = emptyDocument(100, 100);
    const layer = addLayer(doc, 'a');
    layer.primitives.push({ kind: 'arc', cx: 50, cy: 50, r: 25, startAngleRad: 0, endAngleRad: Math.PI });
    expect(writeSvg(doc)).toContain('<path');
    expect(writeSvg(doc)).toContain(' A ');
  });

  it('text emits with font-size', () => {
    const doc = emptyDocument(100, 100);
    const layer = addLayer(doc, 'a');
    layer.primitives.push({ kind: 'text', x: 10, y: 20, text: 'Hello', fontSize: 12 });
    const xml = writeSvg(doc);
    expect(xml).toContain('font-size="12"');
    expect(xml).toContain('>Hello</text>');
  });

  it('polyline points formatted correctly', () => {
    const doc = emptyDocument(100, 100);
    const layer = addLayer(doc, 'a');
    layer.primitives.push({ kind: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 5 }] });
    expect(writeSvg(doc)).toContain('points="0,0 10,5"');
  });

  it('tiny line dropped when below minSegmentLength', () => {
    const doc = emptyDocument(10, 10);
    const layer = addLayer(doc, 'a');
    layer.primitives.push({ kind: 'line', start: { x: 0, y: 0 }, end: { x: 0.001, y: 0 } });
    expect(writeSvg(doc, { minSegmentLength: 0.01 })).not.toContain('<line');
  });
});

describe('fitDocumentToContent', () => {
  it('viewBox grows to enclose primitives', () => {
    const doc = emptyDocument(10, 10);
    const layer = addLayer(doc, 'a');
    layer.primitives.push({ kind: 'rect', x: -20, y: -20, width: 40, height: 40 });
    fitDocumentToContent(doc, 5);
    expect(doc.viewBox.x).toBe(-25);
    expect(doc.viewBox.width).toBe(50);
  });

  it('empty doc unchanged', () => {
    const doc = emptyDocument(100, 100);
    fitDocumentToContent(doc);
    expect(doc.viewBox).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });
});

describe('summarize', () => {
  it('counts by kind', () => {
    const doc = sampleDoc();
    const s = summarize(doc);
    expect(s.layerCount).toBe(1);
    expect(s.primitiveCount).toBe(3);
    expect(s.primitivesByKind.line).toBe(1);
    expect(s.primitivesByKind.rect).toBe(1);
    expect(s.primitivesByKind.circle).toBe(1);
  });

  it('empty doc returns zero counts', () => {
    const s = summarize(emptyDocument(100, 100));
    expect(s.primitiveCount).toBe(0);
  });
});
