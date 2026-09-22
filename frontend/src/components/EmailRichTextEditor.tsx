import React, { useRef, useEffect, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Link as LinkIcon,
  Code,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Image,
  Minus,
  Palette,
  RemoveFormatting,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { emailTemplateFillFields } from '@/lib/emailStarterTemplates';
import {
  emailPreviewSrcDoc,
  isStructuredEmailHtml,
  looksLikeEmailMarkup,
  recoverPastedEmailHtml,
} from '@/lib/recoverPastedEmailHtml';

/** Normalize HTML for storage: keep real markup, wrap plain text in paragraphs. */
function looksLikeHtml(html: string): boolean {
  return looksLikeEmailMarkup(html);
}

function normalizeHtml(html: string): string {
  const t = (html || '').trim();
  if (!t) return '';
  if (!looksLikeHtml(t)) return `<p>${t.replace(/\n/g, '</p><p>')}</p>`;
  return t;
}

/** Strip wrapper <p></p> for display in contenteditable when empty */
function emptyOrHtml(html: string): string {
  const t = (html || '').trim();
  if (!t) return '';
  return t;
}

const TEXT_COLORS = [
  '#000000', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#2563eb',
  '#7c3aed', '#db2777', '#64748b', '#0ea5e9', '#14b8a6', '#a1a1aa',
];

export interface EmailRichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string | number;
  id?: string;
  className?: string;
  /** Label for the editor (e.g. "Body") */
  label?: string;
  /** Compact toolbar (fewer buttons) */
  compact?: boolean;
  /** Hide the Visual/HTML mode tabs (used when parent manages mode) */
  hideModeTabs?: boolean;
  /** Fill flex parent height instead of using minHeight */
  stretch?: boolean;
  /** Show friendly click-to-insert fillable field chips (for non-technical users) */
  showInsertFields?: boolean;
}

export type EmailRichTextEditorHandle = {
  insertField: (token: string) => void;
  focus: () => void;
};

export const EmailRichTextEditor = forwardRef<EmailRichTextEditorHandle, EmailRichTextEditorProps>(function EmailRichTextEditor({
  value,
  onChange,
  placeholder = 'Write your message…',
  minHeight = 200,
  id,
  className,
  label,
  compact = false,
  hideModeTabs = false,
  stretch = false,
  showInsertFields = false,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null);
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const lastEmittedRef = useRef<string | null>(null);
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [htmlSource, setHtmlSource] = useState(value);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
    strikeThrough: false,
    insertUnorderedList: false,
    insertOrderedList: false,
    justifyLeft: false,
    justifyCenter: false,
    justifyRight: false,
  });
  const [showPlaceholder, setShowPlaceholder] = useState(() => {
    const t = (value || '').trim();
    if (!t) return true;
    const stripped = t.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    return stripped === '';
  });

  const getEditorHtml = useCallback((): string => {
    const el = editorRef.current;
    if (!el) return '';
    return el.innerHTML.trim() || '';
  }, []);

  const setEditorHtml = useCallback((html: string) => {
    const el = editorRef.current;
    if (!el) return;
    const safe = emptyOrHtml(html || '');
    el.innerHTML = safe || '<p><br></p>';
    lastEmittedRef.current = normalizeHtml(safe);
  }, []);

  const refreshActiveFormats = useCallback(() => {
    if (mode !== 'visual') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const node = sel.anchorNode;
    if (!node || !editorRef.current?.contains(node)) return;
    try {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        strikeThrough: document.queryCommandState('strikeThrough'),
        insertUnorderedList: document.queryCommandState('insertUnorderedList'),
        insertOrderedList: document.queryCommandState('insertOrderedList'),
        justifyLeft: document.queryCommandState('justifyLeft'),
        justifyCenter: document.queryCommandState('justifyCenter'),
        justifyRight: document.queryCommandState('justifyRight'),
      });
    } catch {
      // queryCommandState can throw in some browsers for unsupported commands
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== 'visual') return;
    const onSelChange = () => refreshActiveFormats();
    document.addEventListener('selectionchange', onSelChange);
    return () => document.removeEventListener('selectionchange', onSelChange);
  }, [mode, refreshActiveFormats]);

  const structuredPreview = isStructuredEmailHtml(recoverPastedEmailHtml(value));

  useEffect(() => {
    if (mode !== 'visual') return;
    const recovered = recoverPastedEmailHtml(value);
    // Table/full emails must not go through contenteditable — the browser
    // drops <html>/<body> and flattens tables into unstyled text.
    if (isStructuredEmailHtml(recovered)) {
      lastEmittedRef.current = recovered;
      setShowPlaceholder(false);
      return;
    }
    const normalized = normalizeHtml(value);
    if (lastEmittedRef.current === null || normalized !== lastEmittedRef.current) {
      lastEmittedRef.current = normalized;
      setEditorHtml(value);
      const stripped = (value || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
      setShowPlaceholder(stripped === '');
    }
  }, [value, mode, setEditorHtml]);

  useEffect(() => {
    if (mode === 'html') return;
    setHtmlSource(recoverPastedEmailHtml(value));
  }, [value, mode]);

  useEffect(() => {
    if (mode !== 'visual' || !structuredPreview) return;
    const iframe = previewIframeRef.current;
    if (!iframe) return;
    const src = emailPreviewSrcDoc(value);
    const syncHeight = () => {
      try {
        const doc = iframe.contentDocument;
        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight;
        iframe.style.height = `${Math.max(h || 0, 320)}px`;
      } catch {
        iframe.style.height = '480px';
      }
    };
    iframe.addEventListener('load', syncHeight);
    iframe.srcdoc = src;
    return () => iframe.removeEventListener('load', syncHeight);
  }, [value, mode, structuredPreview]);

  const emitChange = useCallback(
    (raw: string) => {
      const normalized = normalizeHtml(raw);
      if (normalized === lastEmittedRef.current) return;
      lastEmittedRef.current = normalized;
      onChange(normalized);
    },
    [onChange]
  );

  const handleInput = useCallback(() => {
    if (mode !== 'visual') return;
    if (isStructuredEmailHtml(recoverPastedEmailHtml(value))) return;
    const html = getEditorHtml();
    emitChange(html);
    refreshActiveFormats();
  }, [mode, getEditorHtml, emitChange, refreshActiveFormats, value]);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain') || '';
      const recovered = recoverPastedEmailHtml(text);
      const markup = looksLikeHtml(recovered) ? recovered : looksLikeHtml(text) ? text : '';
      if (markup) {
        if (isStructuredEmailHtml(markup)) {
          const recovered = recoverPastedEmailHtml(markup);
          lastEmittedRef.current = recovered;
          setHtmlSource(recovered);
          onChange(recovered);
          return;
        }
        document.execCommand('insertHTML', false, markup);
        setTimeout(handleInput, 0);
        return;
      }
      document.execCommand('insertText', false, text);
      setTimeout(handleInput, 0);
    },
    [handleInput, onChange]
  );

  const exec = useCallback((cmd: string, value?: string) => {
    document.execCommand(cmd, false, value);
    editorRef.current?.focus();
    handleInput();
    refreshActiveFormats();
  }, [handleInput, refreshActiveFormats]);

  // Safe block-format: replaces the tag in-place when already a heading to avoid nesting
  const execFormatBlock = useCallback((tag: string) => {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || !editorRef.current) return;

    let node: Node | null = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;

    const BLOCKS = new Set(['P','H1','H2','H3','H4','H5','H6','DIV','BLOCKQUOTE','PRE']);
    let blockEl: Element | null = null;
    let cur: Node | null = node;
    while (cur && cur !== editorRef.current) {
      if (cur instanceof Element && BLOCKS.has(cur.tagName)) { blockEl = cur; break; }
      cur = cur.parentNode;
    }

    if (blockEl && /^H[1-6]$/.test(blockEl.tagName)) {
      // Replace the heading element directly — no nesting
      const newEl = document.createElement(tag);
      while (blockEl.firstChild) newEl.appendChild(blockEl.firstChild);
      blockEl.parentNode?.replaceChild(newEl, blockEl);
      const range = document.createRange();
      range.selectNodeContents(newEl);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      document.execCommand('formatBlock', false, tag);
    }

    editorRef.current?.focus();
    handleInput();
    refreshActiveFormats();
  }, [handleInput, refreshActiveFormats]);

  const addLink = useCallback(() => {
    const url = window.prompt('Enter URL:');
    if (url) exec('createLink', url);
  }, [exec]);

  const addImage = useCallback(() => {
    const url = window.prompt('Image URL:');
    if (url) exec('insertImage', url);
  }, [exec]);

  const insertField = useCallback((token: string) => {
    const recovered = recoverPastedEmailHtml(mode === 'html' ? htmlSource : value);
    if (mode === 'html' || isStructuredEmailHtml(recovered)) {
      const next = `${recovered}${token}`;
      setHtmlSource(next);
      lastEmittedRef.current = next;
      onChange(next);
      return;
    }
    editorRef.current?.focus();
    // Prefer insertText so {{tokens}} stay as plain fillable text
    const ok = document.execCommand('insertText', false, token);
    if (!ok) {
      document.execCommand('insertHTML', false, token);
    }
    handleInput();
    refreshActiveFormats();
  }, [handleInput, htmlSource, mode, onChange, refreshActiveFormats, value]);

  useImperativeHandle(ref, () => ({
    insertField,
    focus: () => editorRef.current?.focus(),
  }), [insertField]);

  const switchToHtml = useCallback(() => {
    const recovered = recoverPastedEmailHtml(value);
    if (isStructuredEmailHtml(recovered)) {
      setHtmlSource(recovered);
    } else {
      setHtmlSource(normalizeHtml(getEditorHtml() || recovered) || '');
    }
    setMode('html');
  }, [getEditorHtml, value]);

  const switchToVisual = useCallback(() => {
    const recovered = recoverPastedEmailHtml(htmlSource || value);
    if (isStructuredEmailHtml(recovered)) {
      lastEmittedRef.current = recovered;
    } else {
      // Contenteditable remounts; force a write from value.
      lastEmittedRef.current = null;
    }
    onChange(recovered);
    const stripped = recovered.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    setShowPlaceholder(stripped === '');
    setMode('visual');
  }, [htmlSource, onChange, value]);

  const styleMinHeight = typeof minHeight === 'number' ? `${minHeight}px` : minHeight;

  const updatePlaceholder = useCallback(() => {
    const html = getEditorHtml();
    if (!html || !html.trim()) {
      setShowPlaceholder(true);
      return;
    }
    const stripped = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    setShowPlaceholder(stripped === '');
  }, [getEditorHtml]);

  const ToolbarBtn = ({
    onClick,
    title,
    children,
    className: cls,
    active = false,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
    className?: string;
    active?: boolean;
  }) => (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={active}
      className={cn(
        'h-8 w-8 rounded-md transition-colors',
        active
          ? 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
        cls,
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      title={title}
    >
      {children}
    </Button>
  );

  const Sep = () => <div className="w-px h-5 bg-border/80 mx-1" />;

  return (
    <div className={cn(stretch ? 'flex flex-col flex-1 min-h-0' : 'space-y-2', className)}>
      {!hideModeTabs && (
        <div className="flex items-center justify-between gap-2">
          {label ? <span className="text-sm font-medium leading-none">{label}</span> : <span />}
          <Tabs
            value={mode}
            onValueChange={(v) => {
              if (v === 'html') switchToHtml();
              else switchToVisual();
            }}
          >
            <TabsList className="h-8">
              <TabsTrigger value="visual" className="gap-1.5 text-xs">
                <Type className="h-3.5 w-3.5" />
                Visual
              </TabsTrigger>
              <TabsTrigger value="html" className="gap-1.5 text-xs">
                <Code className="h-3.5 w-3.5" />
                HTML
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      )}

      {hideModeTabs && label && (
        <span className="text-sm font-medium leading-none">{label}</span>
      )}

      {mode === 'visual' ? (
        structuredPreview ? (
        <div
          className={cn(
            'rounded-lg border border-border bg-background overflow-hidden shadow-sm',
            stretch && 'flex flex-col flex-1 min-h-0',
          )}
        >
          <div className="px-3 py-2 border-b border-border bg-muted/40 text-xs text-muted-foreground shrink-0">
            Full HTML email — shown as the client will see it.
            {!hideModeTabs ? ' Switch to HTML to edit the source.' : ' Use the HTML tab to edit the source.'}
          </div>
          <div className={cn('overflow-auto bg-muted/40', stretch && 'flex-1')}>
            <iframe
              ref={previewIframeRef}
              sandbox="allow-same-origin"
              title="Email preview"
              className="w-full border-0 bg-white"
              style={{ minHeight: stretch ? 320 : styleMinHeight }}
            />
          </div>
        </div>
        ) : (
        <div
          className={cn(
            'rounded-lg border border-border bg-background overflow-hidden shadow-sm',
            'focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/15',
            stretch && 'flex flex-col flex-1 min-h-0',
          )}
        >
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/40 px-2 py-1.5 shrink-0">
            {/* Heading buttons */}
            {!compact && (
              <>
                <ToolbarBtn onClick={() => execFormatBlock('h1')} title="Heading 1">
                  <Heading1 className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => execFormatBlock('h2')} title="Heading 2">
                  <Heading2 className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => execFormatBlock('h3')} title="Heading 3">
                  <Heading3 className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => execFormatBlock('p')} title="Paragraph">
                  <Pilcrow className="h-4 w-4" />
                </ToolbarBtn>
                <Sep />
              </>
            )}

            {/* Text formatting */}
            <ToolbarBtn onClick={() => exec('bold')} title="Bold" active={activeFormats.bold}>
              <Bold className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => exec('italic')} title="Italic" active={activeFormats.italic}>
              <Italic className="h-4 w-4" />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => exec('underline')} title="Underline" active={activeFormats.underline}>
              <Underline className="h-4 w-4" />
            </ToolbarBtn>
            {!compact && (
              <ToolbarBtn onClick={() => exec('strikeThrough')} title="Strikethrough" active={activeFormats.strikeThrough}>
                <Strikethrough className="h-4 w-4" />
              </ToolbarBtn>
            )}

            {!compact && (
              <>
                <Sep />
                {/* Alignment */}
                <ToolbarBtn onClick={() => exec('justifyLeft')} title="Align left" active={activeFormats.justifyLeft}>
                  <AlignLeft className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => exec('justifyCenter')} title="Align center" active={activeFormats.justifyCenter}>
                  <AlignCenter className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => exec('justifyRight')} title="Align right" active={activeFormats.justifyRight}>
                  <AlignRight className="h-4 w-4" />
                </ToolbarBtn>
              </>
            )}

            {!compact && (
              <>
                <Sep />
                {/* Lists */}
                <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Bullet list" active={activeFormats.insertUnorderedList}>
                  <List className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => exec('insertOrderedList')} title="Numbered list" active={activeFormats.insertOrderedList}>
                  <ListOrdered className="h-4 w-4" />
                </ToolbarBtn>
              </>
            )}

            {!compact && (
              <>
                <Sep />
                {/* Insert */}
                <ToolbarBtn onClick={addLink} title="Insert link">
                  <LinkIcon className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={addImage} title="Insert image">
                  <Image className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={() => exec('insertHorizontalRule')} title="Horizontal line">
                  <Minus className="h-4 w-4" />
                </ToolbarBtn>
              </>
            )}

            {compact && (
              <>
                <Sep />
                <ToolbarBtn onClick={() => exec('insertUnorderedList')} title="Bullet list" active={activeFormats.insertUnorderedList}>
                  <List className="h-4 w-4" />
                </ToolbarBtn>
                <ToolbarBtn onClick={addLink} title="Insert link">
                  <LinkIcon className="h-4 w-4" />
                </ToolbarBtn>
              </>
            )}

            {!compact && (
              <>
                <Sep />
                {/* Text color */}
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
                      title="Text color"
                      onMouseDown={(e) => e.preventDefault()}
                    >
                      <Palette className="h-4 w-4" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-2" align="start">
                    <div className="grid grid-cols-6 gap-1">
                      {TEXT_COLORS.map((color) => (
                        <button
                          key={color}
                          className="w-6 h-6 rounded border border-border hover:scale-110 transition-transform"
                          style={{ backgroundColor: color }}
                          onMouseDown={(e) => { e.preventDefault(); exec('foreColor', color); }}
                          title={color}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <ToolbarBtn onClick={() => exec('removeFormat')} title="Clear formatting">
                  <RemoveFormatting className="h-4 w-4" />
                </ToolbarBtn>
              </>
            )}
          </div>
          {showInsertFields && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-background px-3 py-2 shrink-0 sticky top-0 z-10">
              <span className="text-[11px] font-medium text-muted-foreground mr-1 shrink-0">
                Insert field
              </span>
              {emailTemplateFillFields.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  title={field.hint}
                  className="inline-flex items-center rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertField(field.key);
                  }}
                >
                  {field.label}
                </button>
              ))}
            </div>
          )}
          {/* Contenteditable area */}
          <div
            ref={editorRef}
            id={id}
            contentEditable
            role="textbox"
            aria-multiline="true"
            aria-label={label || placeholder}
            data-placeholder={placeholder}
            className={cn(
              'prose prose-sm dark:prose-invert max-w-none min-w-0 px-4 py-3 text-sm outline-none',
              stretch && 'flex-1 overflow-y-auto',
              showPlaceholder && 'before:content-[attr(data-placeholder)] before:text-muted-foreground before:pointer-events-none'
            )}
            style={stretch ? { minHeight: 0 } : { minHeight: styleMinHeight }}
            onInput={() => {
              handleInput();
              updatePlaceholder();
            }}
            onKeyUp={refreshActiveFormats}
            onMouseUp={refreshActiveFormats}
            onPaste={handlePaste}
            suppressContentEditableWarning
          />
        </div>
        )
      ) : (
        <div className={cn('space-y-1', stretch && 'flex flex-col flex-1 min-h-0')}>
          <p className="text-xs text-muted-foreground">Edit raw HTML. Switch back to Visual to see formatting.</p>
          <Textarea
            value={htmlSource}
            onChange={(e) => {
              const next = e.target.value;
              setHtmlSource(next);
              lastEmittedRef.current = next;
              onChange(next);
            }}
            placeholder="<p>Your HTML here...</p>"
            className={cn('font-mono text-sm min-h-[120px]', stretch && 'flex-1')}
            rows={10}
          />
        </div>
      )}
    </div>
  );
});

EmailRichTextEditor.displayName = 'EmailRichTextEditor';
