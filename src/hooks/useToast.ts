'use client';

/**
 * Convenience wrapper around ToastProvider's context.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('저장되었습니다.');
 *   toast.error('오류가 발생했습니다.');
 *   toast.info('알림 메시지');
 *   toast.warning('경고 메시지');
 *   toast.show('success', '메시지'); // raw call
 */

import { useToast as useToastCtx } from '@/components/ToastProvider';

export function useToast() {
  const { toast } = useToastCtx();
  return {
    success: (msg: string) => toast('success', msg),
    error:   (msg: string) => toast('error',   msg),
    info:    (msg: string) => toast('info',     msg),
    warning: (msg: string) => toast('warning',  msg),
    show:    toast,
  };
}
