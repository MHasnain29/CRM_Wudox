/**
 * Draft document files for the employee form.
 *
 * localStorage drafts (localExtras) are JSON-only and cannot hold File
 * objects, so "Save Draft" used to silently drop every selected document.
 * This module persists those files in IndexedDB (no 5MB limit, native File
 * support) keyed by draft id, so restoring a draft brings the documents back.
 *
 * Draft id mirrors localExtras' draft key: the employee id when editing,
 * or "new" for a not-yet-created employee.
 */

import type { EmployeeFormState } from './formTypes';

const DB_NAME = 'employee-form-draft-files';
const DB_VERSION = 1;
const STORE = 'files';

/** Slot keys: fixed doc slots, `license:<uid>` per license, `profilePhoto`. */
export type DraftFileMap = Record<string, File>;

const NEW_DRAFT_ID = 'new';
const draftIdOf = (employeeId?: string) => employeeId || NEW_DRAFT_ID;
const recordKey = (draftId: string, slot: string) => `${draftId}/${slot}`;
const draftRange = (draftId: string) =>
  IDBKeyRange.bound(`${draftId}/`, `${draftId}/\uffff`);

type StoredFileRecord = {
  key: string;
  slot: string;
  blob: Blob;
  name: string;
  type: string;
  lastModified: number;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
  });
}

/**
 * Replace all stored files for a draft with the given map.
 * Returns false when persistence failed (e.g. IndexedDB unavailable).
 */
export async function saveDraftFiles(
  employeeId: string | undefined,
  files: DraftFileMap,
): Promise<boolean> {
  const draftId = draftIdOf(employeeId);
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      store.delete(draftRange(draftId));
      for (const [slot, file] of Object.entries(files)) {
        const record: StoredFileRecord = {
          key: recordKey(draftId, slot),
          slot,
          blob: file,
          name: file.name,
          type: file.type,
          lastModified: file.lastModified,
        };
        store.put(record);
      }
      await txDone(tx);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** Load all stored files for a draft. Returns an empty map on any failure. */
export async function loadDraftFiles(employeeId?: string): Promise<DraftFileMap> {
  const draftId = draftIdOf(employeeId);
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAll(draftRange(draftId));
      const records = await new Promise<StoredFileRecord[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result as StoredFileRecord[]);
        request.onerror = () => reject(request.error ?? new Error('Read failed'));
      });
      const files: DraftFileMap = {};
      for (const r of records) {
        files[r.slot] = new File([r.blob], r.name, {
          type: r.type,
          lastModified: r.lastModified,
        });
      }
      return files;
    } finally {
      db.close();
    }
  } catch {
    return {};
  }
}

/** Remove all stored files for a draft (after submit or discard). */
export async function clearDraftFiles(employeeId?: string): Promise<void> {
  const draftId = draftIdOf(employeeId);
  try {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(draftRange(draftId));
      await txDone(tx);
    } finally {
      db.close();
    }
  } catch {
    /* non-critical cleanup */
  }
}

// ── Form <-> file-map helpers ──────────────────────────────────────────────

export const PROFILE_PHOTO_SLOT = 'profilePhoto';

/** Collect every newly selected file from the form (plus profile photo). */
export function collectDraftFiles(
  form: EmployeeFormState,
  profilePhoto: File | null,
): DraftFileMap {
  const files: DraftFileMap = {};
  const slots: Array<[string, File | null]> = [
    ['photoId', form.photoId.file],
    ['statusDoc', form.statusDoc.file],
    ['sinDoc', form.sinDoc.file],
    ['agreementDoc', form.agreementDoc.file],
    ['depositDoc', form.depositDoc.file],
    [PROFILE_PHOTO_SLOT, profilePhoto],
  ];
  for (const [slot, file] of slots) {
    if (file) files[slot] = file;
  }
  for (const license of form.licenses) {
    if (license.file) files[`license:${license.uid}`] = license.file;
  }
  return files;
}

/** Re-attach restored draft files to a form snapshot. */
export function applyDraftFiles(
  form: EmployeeFormState,
  files: DraftFileMap,
): EmployeeFormState {
  const withFile = <T extends { file: File | null }>(slot: T, file?: File): T =>
    file ? { ...slot, file } : slot;
  return {
    ...form,
    photoId: withFile(form.photoId, files.photoId),
    statusDoc: withFile(form.statusDoc, files.statusDoc),
    sinDoc: withFile(form.sinDoc, files.sinDoc),
    agreementDoc: withFile(form.agreementDoc, files.agreementDoc),
    depositDoc: withFile(form.depositDoc, files.depositDoc),
    licenses: form.licenses.map((l) => withFile(l, files[`license:${l.uid}`])),
  };
}
