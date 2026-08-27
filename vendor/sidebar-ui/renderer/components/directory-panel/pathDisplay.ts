export { getFolderName } from '@/utils/taskCenterUtils';

export function waitForTreeFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}
