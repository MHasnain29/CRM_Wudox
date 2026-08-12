import { useRef, useState } from 'react';
import { Eye, FileCheck2, FileText, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import type { ExistingDocRef } from './formTypes';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const DEFAULT_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg';

function formatFileSize(bytes: number) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

/**
 * Compact document upload control: dashed "Upload file" button that turns
 * into a file chip once a file is chosen (or an existing uploaded doc is present).
 * Optional onView for already-uploaded server docs.
 */
export function UploadField({
  file,
  existingDoc,
  onFile,
  onClear,
  onView,
  accept = DEFAULT_ACCEPT,
  disabled,
  className,
}: {
  file: File | null;
  existingDoc?: ExistingDocRef | null;
  onFile: (file: File) => void;
  onClear: () => void;
  /** View already-uploaded document (existingDoc with id). */
  onView?: () => void | Promise<void>;
  accept?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState(false);

  const handleSelect = (files: FileList | null) => {
    const selected = files?.[0];
    if (!selected) return;
    if (selected.size > MAX_FILE_SIZE) {
      toast({
        title: 'File too large',
        description: `${selected.name} exceeds the 20MB limit.`,
        variant: 'destructive',
      });
      return;
    }
    onFile(selected);
  };

  const chip = file
    ? { icon: FileText, name: file.name, meta: formatFileSize(file.size), uploaded: false }
    : existingDoc
      ? {
          icon: FileCheck2,
          name: existingDoc.fileName || existingDoc.name,
          meta: `Uploaded · ${formatFileSize(existingDoc.fileSize)}`,
          uploaded: true,
        }
      : null;

  const canView = Boolean(onView && existingDoc?.id && !file);

  const handleView = async () => {
    if (!onView || viewing) return;
    setViewing(true);
    try {
      await onView();
    } catch {
      toast({ title: 'Failed to open document', variant: 'destructive' });
    } finally {
      setViewing(false);
    }
  };

  return (
    <div className={cn('min-w-0', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          handleSelect(e.target.files);
          e.target.value = '';
        }}
      />
      {chip ? (
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border px-2.5 h-10',
            chip.uploaded ? 'border-green-200 bg-green-50/60' : 'border-primary/30 bg-primary/5',
          )}
        >
          <chip.icon
            className={cn('h-4 w-4 shrink-0', chip.uploaded ? 'text-green-600' : 'text-primary')}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium truncate leading-tight">{chip.name}</p>
            <p className="text-[10px] text-muted-foreground leading-tight">{chip.meta}</p>
          </div>
          {canView && (
            <button
              type="button"
              onClick={() => void handleView()}
              disabled={viewing || disabled}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              aria-label="View document"
              title="View"
            >
              {viewing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          {!disabled && (
            <button
              type="button"
              onClick={onClear}
              className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Remove file"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="w-full h-10 border-dashed text-muted-foreground hover:text-foreground gap-1.5 font-normal"
        >
          <Upload className="h-3.5 w-3.5" />
          Upload file
        </Button>
      )}
    </div>
  );
}
