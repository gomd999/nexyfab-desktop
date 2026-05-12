import { useCallback } from 'react';
import type { MutableRefObject } from 'react';

/**
 * Step 5.5 of the MainWorkspace decomposition plan.
 *
 * Wraps the 5 pin-comment callbacks the canvas exposes — add / resolve /
 * delete / react / reply — into stable useCallback identities, with the
 * shared author-name / user-color / activity-feed plumbing applied once
 * here instead of duplicated at each call site.
 */
export type PinCommentPosition = [number, number, number];
export type PinCommentType = 'comment' | 'issue' | 'approval';

export interface UseCanvasPinCommentHandlersArgs {
  authUserName: string | undefined | null;
  collabUserColorRef: MutableRefObject<string>;
  collabUserIdRef: MutableRefObject<string>;
  addComment: (
    pos: PinCommentPosition,
    text: string,
    author: string,
    type: PinCommentType,
    color: string,
  ) => void;
  resolveComment: (id: string) => void;
  deleteComment: (id: string) => void;
  reactToComment: (id: string, emoji: string, userId: string) => void;
  addReply: (id: string, text: string, author: string, color: string) => void;
  addActivity: (a: { type: 'comment_resolve' | 'comment_delete'; actor: string }) => void;
}

export interface UseCanvasPinCommentHandlersResult {
  onAddPinComment: (
    pos: PinCommentPosition,
    text: string,
    type?: PinCommentType,
  ) => void;
  onResolvePinComment: (id: string) => void;
  onDeletePinComment: (id: string) => void;
  onReactPinComment: (id: string, emoji: string) => void;
  onReplyPinComment: (id: string, text: string) => void;
}

export function useCanvasPinCommentHandlers(
  args: UseCanvasPinCommentHandlersArgs,
): UseCanvasPinCommentHandlersResult {
  const {
    authUserName,
    collabUserColorRef,
    collabUserIdRef,
    addComment,
    resolveComment,
    deleteComment,
    reactToComment,
    addReply,
    addActivity,
  } = args;

  const guestName = authUserName ?? 'Guest';
  const youName = authUserName ?? 'You';

  const onAddPinComment = useCallback((pos: PinCommentPosition, text: string, type?: PinCommentType) => {
    addComment(pos, text, guestName, type ?? 'comment', collabUserColorRef.current);
  }, [addComment, guestName, collabUserColorRef]);

  const onResolvePinComment = useCallback((id: string) => {
    resolveComment(id);
    addActivity({ type: 'comment_resolve', actor: youName });
  }, [resolveComment, addActivity, youName]);

  const onDeletePinComment = useCallback((id: string) => {
    deleteComment(id);
    addActivity({ type: 'comment_delete', actor: youName });
  }, [deleteComment, addActivity, youName]);

  const onReactPinComment = useCallback((id: string, emoji: string) => {
    reactToComment(id, emoji, collabUserIdRef.current);
  }, [reactToComment, collabUserIdRef]);

  const onReplyPinComment = useCallback((id: string, text: string) => {
    const replyAuthor = authUserName ?? `User-${collabUserIdRef.current.slice(-4)}`;
    addReply(id, text, replyAuthor, collabUserColorRef.current);
  }, [addReply, authUserName, collabUserIdRef, collabUserColorRef]);

  return {
    onAddPinComment,
    onResolvePinComment,
    onDeletePinComment,
    onReactPinComment,
    onReplyPinComment,
  };
}
