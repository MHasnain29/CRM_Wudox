import {
  downloadEmailAttachment,
  fetchEmailAttachmentBlob,
  type ApiEmailDetail,
} from '@/lib/api';
import { CrmAttachmentList } from '@/components/CrmAttachmentList';

interface EmailAttachmentBarProps {
  email: ApiEmailDetail;
}

export function EmailAttachmentBar({ email }: EmailAttachmentBarProps) {
  const atts = email.attachments ?? [];
  if (atts.length === 0) return null;

  return (
    <CrmAttachmentList
      className="border-t pt-3 mt-1"
      showHeader
      items={atts.map((a) => ({
        id: a.id,
        name: a.filename,
        mimeType: a.mimeType,
        size: a.size,
      }))}
      fetchBlob={(item) => fetchEmailAttachmentBlob(email.id, item.id)}
      onDownload={async (item) => {
        const result = await downloadEmailAttachment(email.id, item.id, item.name);
        if (!result.ok) throw new Error('Download failed');
      }}
    />
  );
}
