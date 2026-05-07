'use client';
import { useEffect } from 'react';

export default function SgBodyMode() {
  useEffect(() => {
    document.body.classList.add('sg-mode');
    return () => {
      document.body.classList.remove('sg-mode');
      document.body.classList.remove('sg-fs-hide');
    };
  }, []);
  return null;
}
