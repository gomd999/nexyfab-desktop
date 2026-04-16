import type { PostProcessor } from './types';
import { linuxcncPost } from './linuxcnc';
import { fanucPost } from './fanuc';
import { mazakPost } from './mazak';
import { haasPost } from './haas';

export type { PostProcessor, PostContext } from './types';
export { linuxcncPost, fanucPost, mazakPost, haasPost };

export const POST_PROCESSORS: Record<string, PostProcessor> = {
  linuxcnc: linuxcncPost,
  fanuc: fanucPost,
  mazak: mazakPost,
  haas: haasPost,
};

export type PostProcessorId = keyof typeof POST_PROCESSORS;

export const POST_PROCESSOR_ORDER: PostProcessorId[] = ['linuxcnc', 'fanuc', 'mazak', 'haas'];

export function getPostProcessor(id: string | undefined): PostProcessor {
  if (!id) return linuxcncPost;
  return POST_PROCESSORS[id] ?? linuxcncPost;
}
