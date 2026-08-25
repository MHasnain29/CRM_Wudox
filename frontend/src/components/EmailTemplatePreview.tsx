import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fillPlaceholders } from '@/lib/emailStarterTemplates';

interface EmailTemplatePreviewProps {
  html: string;
  agencyFooterText?: string | null;
  agencyName?: string | null;
  className?: string;
}

export function EmailTemplatePreview({ html, agencyFooterText, agencyName, className }: EmailTemplatePreviewProps) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const previewHtml = fillPlaceholders(html, agencyFooterText, agencyName);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const syncHeight = () => {
      try {
        const doc = iframe.contentDocument;
        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight;
        iframe.style.height = `${Math.max(h || 0, 420)}px`;
      } catch {
        iframe.style.height = '500px';
      }
    };

    iframe.addEventListener('load', syncHeight);
    iframe.style.height = '420px';
    iframe.srcdoc = previewHtml;
    return () => iframe.removeEventListener('load', syncHeight);
  }, [previewHtml]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Device toggle */}
      <div className="flex items-center justify-center gap-2 py-3 border-b bg-muted/30">
        <Button
          variant={device === 'desktop' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setDevice('desktop')}
        >
          <Monitor className="h-3.5 w-3.5" />
          Desktop
        </Button>
        <Button
          variant={device === 'mobile' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 text-xs"
          onClick={() => setDevice('mobile')}
        >
          <Smartphone className="h-3.5 w-3.5" />
          Mobile
        </Button>
      </div>

      {/* Preview area */}
      <div className="flex-1 overflow-auto bg-muted/50 p-6">
        <div
          className={cn(
            'mx-auto bg-white rounded-lg shadow-xl overflow-hidden transition-all duration-300',
            device === 'desktop' ? 'max-w-[600px]' : 'max-w-[375px]'
          )}
        >
          {/* Email client header bar */}
          <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 border-b">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
            <span className="text-[10px] text-gray-400 ml-2">Email Preview</span>
          </div>
          <iframe
            ref={iframeRef}
            sandbox="allow-same-origin"
            className="w-full border-none"
            style={{ minHeight: '320px' }}
            title="Email template preview"
          />
        </div>
      </div>
    </div>
  );
}
