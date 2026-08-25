/**
 * Personal template editor: paste HTML, then preview the exact email the client receives.
 */
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react';
import { Code, Eye } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { EmailTemplatePreview } from '@/components/EmailTemplatePreview';
import { cn } from '@/lib/utils';

export type CustomTemplateBodyEditorHandle = {
  insertField: (token: string) => void;
  getHtml: () => string;
};

type EditorTab = 'html' | 'preview';

interface CustomTemplateBodyEditorProps {
  value: string;
  onChange: (html: string) => void;
  agencyFooterText?: string | null;
  agencyName?: string | null;
  disabled?: boolean;
  className?: string;
}

function insertAtSelection(current: string, token: string, start: number, end: number) {
  return current.slice(0, start) + token + current.slice(end);
}

export const CustomTemplateBodyEditor = forwardRef<
  CustomTemplateBodyEditorHandle,
  CustomTemplateBodyEditorProps
>(function CustomTemplateBodyEditor(
  { value, onChange, agencyFooterText, agencyName, disabled, className },
  ref,
) {
  const [tab, setTab] = useState<EditorTab>(value.trim() ? 'preview' : 'html');
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  const rememberSelection = useCallback(() => {
    const ta = htmlRef.current;
    if (!ta) return;
    selectionRef.current = { start: ta.selectionStart, end: ta.selectionEnd };
  }, []);

  const insertField = useCallback(
    (token: string) => {
      const ta = htmlRef.current;
      if (!ta) {
        const next = value + token;
        onChange(next);
        selectionRef.current = { start: next.length, end: next.length };
        setTab('html');
        requestAnimationFrame(() => {
          const el = htmlRef.current;
          if (!el) return;
          el.focus();
          el.setSelectionRange(next.length, next.length);
        });
        return;
      }
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = insertAtSelection(value, token, start, end);
      onChange(next);
      selectionRef.current = { start: start + token.length, end: start + token.length };
      requestAnimationFrame(() => {
        const el = htmlRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(start + token.length, start + token.length);
      });
    },
    [onChange, value],
  );

  useImperativeHandle(
    ref,
    () => ({
      insertField,
      getHtml: () => value,
    }),
    [insertField, value],
  );

  return (
    <div className={cn('min-w-0 min-h-0 flex flex-col gap-2', className)}>
      <div className="flex items-center justify-between gap-3 shrink-0">
        <Tabs value={tab} onValueChange={(v) => setTab(v as EditorTab)}>
          <TabsList className="h-8">
            <TabsTrigger value="html" className="gap-1.5 text-xs">
              <Code className="h-3.5 w-3.5" />
              HTML
            </TabsTrigger>
            <TabsTrigger value="preview" className="gap-1.5 text-xs">
              <Eye className="h-3.5 w-3.5" />
              Preview
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-[11px] text-muted-foreground text-right leading-snug hidden sm:block">
          {tab === 'html'
            ? 'Paste your email HTML. Preview shows what the client receives.'
            : 'This is the email layout that will be sent to the client.'}
        </p>
      </div>

      {tab === 'html' ? (
        <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-border/70 bg-background overflow-hidden shadow-sm">
          <div className="px-3 py-1.5 border-b border-border/60 bg-muted/40 shrink-0">
            <p className="text-[11px] text-muted-foreground">
              Paste a full HTML email or a body snippet. Saved HTML is sent as-is.
            </p>
          </div>
          <div className="relative flex-1 min-h-0">
            <Textarea
              ref={htmlRef}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              onSelect={rememberSelection}
              onKeyUp={rememberSelection}
              onClick={rememberSelection}
              onBlur={rememberSelection}
              placeholder={'<!DOCTYPE html>\n<html>\n  <body>\n    <p>Hi {{contact_name}},</p>\n  </body>\n</html>'}
              className="absolute inset-0 h-full w-full rounded-none border-0 font-mono text-[12px] leading-relaxed resize-none focus-visible:ring-0"
            />
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 rounded-xl border border-border/70 bg-background overflow-hidden shadow-sm">
          {value.trim() ? (
            <EmailTemplatePreview
              html={value}
              agencyFooterText={agencyFooterText}
              agencyName={agencyName}
              className="h-full"
            />
          ) : (
            <div className="flex h-full min-h-[280px] items-center justify-center px-6 text-center">
              <p className="text-sm text-muted-foreground">
                Paste HTML in the HTML tab to preview your template.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

CustomTemplateBodyEditor.displayName = 'CustomTemplateBodyEditor';
