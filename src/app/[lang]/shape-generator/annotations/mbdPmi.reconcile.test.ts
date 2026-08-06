import { describe, expect, it } from 'vitest';
import { PmiCollection, makeSurfaceFinishPmi } from './mbdPmi';

describe('PmiCollection topology reconciliation', () => {
  it('renames safe PMI and quarantines broken PMI until user restoration', () => {
    const collection = new PmiCollection();
    collection.add(makeSurfaceFinishPmi('safe', 'face-old', 3.2));
    collection.add(makeSurfaceFinishPmi('broken', 'face-gone', 1.6));
    const review = collection.reconcileTopology([
      { previousRef: 'face-old', mappedRef: 'face-new', quality: 'derived', score: 0.9, reason: 'geometry match' },
      { previousRef: 'face-gone', quality: 'broken', score: 0, reason: 'removed face' },
    ]);
    expect(collection.get('safe')?.topoHashes).toEqual(['face-new']);
    expect(collection.get('broken')).toBeUndefined();
    expect(collection.listReview().map(item => item.id)).toEqual(['broken']);
    expect(review).toMatchObject([{ consumer: 'pmi', id: 'broken', quality: 'broken' }]);
    expect(collection.restoreReviewed('broken', ['replacement-face'])).toBe(true);
    expect(collection.get('broken')?.topoHashes).toEqual(['replacement-face']);
  });
});
