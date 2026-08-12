import { useEffect } from 'react';
import { getNotificationStreamUrl } from '@/lib/api';

export function useOnNotification(callback: () => void) {
  useEffect(() => {
    const url = getNotificationStreamUrl();
    if (!url) return;
    const es = new EventSource(url);
    es.onmessage = (event) => {
      if (event.data === 'refresh') callback();
    };
    es.onerror = () => es.close();
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
