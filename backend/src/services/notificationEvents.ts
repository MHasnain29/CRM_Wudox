/**
 * In-memory pub/sub for real-time notification updates.
 * When a notification is created, we emit so SSE clients can push "refresh" to the right user.
 */
import { EventEmitter } from 'events';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const NOTIFICATION_EVENT = 'notification';

export function notifyNotificationCreated(userId: string): void {
  emitter.emit(NOTIFICATION_EVENT, { userId });
}

export function notifyNotificationCreatedForUsers(userIds: string[]): void {
  for (const userId of userIds) {
    emitter.emit(NOTIFICATION_EVENT, { userId });
  }
}

export function onNotificationCreated(callback: (payload: { userId: string }) => void): () => void {
  emitter.on(NOTIFICATION_EVENT, callback);
  return () => emitter.off(NOTIFICATION_EVENT, callback);
}
