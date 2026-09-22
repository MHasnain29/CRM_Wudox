/**
 * Renders a stored email body the way a mail client would.
 * Full / table HTML goes in an iframe so the CRM chrome cannot flatten it.
 */
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { repairLegacyEmailBody } from '@/lib/utils';
import {
  emailPreviewSrcDoc,
  isStructuredEmailHtml,
  recoverPastedEmailHtml,
} from '@/lib/recoverPastedEmailHtml';

export function EmailHtmlBody({
  html,
  className,
}: {
  html: string | null | undefined;
  className?: string;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const recovered = recoverPastedEmailHtml(repairLegacyEmailBody(html));
  const structured = isStructuredEmailHtml(recovered);

  useEffect(() => {
    if (!structured) return;
    const iframe = iframeRef.current;
    if (!iframe) return;
    const src = emailPreviewSrcDoc(recovered);
    const syncHeight = () => {
      try {
        const doc = iframe.contentDocument;
        const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight;
        iframe.style.height = `${Math.max(h || 0, 280)}px`;
      } catch {
        iframe.style.height = '400px';
      }
    };
    iframe.addEventListener('load', syncHeight);
    iframe.srcdoc = src;
    return () => iframe.removeEventListener('load', syncHeight);
  }, [recovered, structured]);

  if (!recovered.trim()) return null;

  if (structured) {
    return (
      <iframe
        ref={iframeRef}
        sandbox="allow-same-origin"
        title="Email body"
        className={cn('w-full border-0 bg-white rounded-md', className)}
        style={{ minHeight: 280 }}
      />
    );
  }

  if (!recovered.trim().startsWith('<')) {
    return (
      <div className={cn('prose prose-sm max-w-none', className)}>
        <p className="whitespace-pre-wrap">{recovered}</p>
      </div>
    );
  }

  return (
    <div
      className={cn('prose prose-sm max-w-none', className)}
      dangerouslySetInnerHTML={{ __html: recovered }}
    />
  );
}
