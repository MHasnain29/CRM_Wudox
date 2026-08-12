import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileText, Loader2 } from 'lucide-react';
import { ClientStatusType } from '@/lib/types';
import { fetchCallScripts, type ApiCallScript } from '@/lib/api';

interface ScriptPanelProps {
  clientStatus?: ClientStatusType;
}

const statusLabels: Record<ClientStatusType, string> = {
  contacted: 'New Contact',
  active: 'Active Client',
  lost: 'Lost Client',
  ex: 'Ex-Client',
  unsubscribed: 'Unsubscribed',
  permanently_closed: 'Permanently Closed',
};

const statusColors: Record<ClientStatusType, string> = {
  contacted: 'bg-blue-500/10 text-blue-600',
  active: 'bg-green-500/10 text-green-600',
  lost: 'bg-red-500/10 text-red-600',
  ex: 'bg-orange-500/10 text-orange-600',
  unsubscribed: 'bg-gray-500/10 text-gray-600',
  permanently_closed: 'bg-gray-500/10 text-gray-600',
};

export function ScriptPanel({ clientStatus }: ScriptPanelProps) {
  const [scripts, setScripts] = useState<ApiCallScript[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchCallScripts()
      .then((data) => {
        const active = data.filter((s) => s.isActive);
        setScripts(active);
        // Auto-select: prefer matching clientStatus, else first
        const match = clientStatus
          ? active.find((s) => s.clientStatus === clientStatus)
          : null;
        setSelectedScriptId(match?.id || active[0]?.id || '');
      })
      .catch(() => setScripts([]))
      .finally(() => setLoading(false));
  }, [clientStatus]);

  const selectedScript = scripts.find((s) => s.id === selectedScriptId);

  return (
    <div className="w-72 bg-gradient-to-b from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 border-r flex flex-col h-full min-h-0 shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">Call Script</span>
        </div>
        {clientStatus && (
          <Badge className={`text-xs ${statusColors[clientStatus]}`}>
            {statusLabels[clientStatus]}
          </Badge>
        )}
      </div>

      {/* Script Selector */}
      {scripts.length > 1 && (
        <div className="px-4 pt-3">
          <Select value={selectedScriptId} onValueChange={setSelectedScriptId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Select a script" />
            </SelectTrigger>
            <SelectContent>
              {scripts.map((s) => (
                <SelectItem key={s.id} value={s.id} className="text-xs">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Script Content */}
      <ScrollArea className="flex-1 min-h-0 p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : selectedScript ? (
          <div className="space-y-4">
            <h3 className="font-semibold text-sm">{selectedScript.name}</h3>
            <div className="prose prose-sm dark:prose-invert max-w-none">
              {selectedScript.content.split('\n').map((line, index) => {
                // Handle bold text marked with **
                if (line.startsWith('**') && line.endsWith('**')) {
                  return (
                    <p key={index} className="font-bold text-primary mt-4 mb-2">
                      {line.replace(/\*\*/g, '')}
                    </p>
                  );
                }
                // Handle bullet points
                if (line.startsWith('•')) {
                  return (
                    <p key={index} className="text-sm text-muted-foreground ml-2 my-1">
                      {line}
                    </p>
                  );
                }
                // Handle quoted text
                if (line.startsWith('"') || line.includes('"')) {
                  return (
                    <p key={index} className="text-sm italic text-foreground bg-primary/5 p-2 rounded my-2">
                      {line}
                    </p>
                  );
                }
                // Handle [placeholders]
                const formattedLine = line.replace(/\[([^\]]+)\]/g, '<span class="text-primary font-medium">[$1]</span>');
                if (formattedLine !== line) {
                  return (
                    <p
                      key={index}
                      className="text-sm text-muted-foreground my-1"
                      dangerouslySetInnerHTML={{ __html: formattedLine }}
                    />
                  );
                }
                // Regular text
                if (line.trim()) {
                  return (
                    <p key={index} className="text-sm text-muted-foreground my-1">
                      {line}
                    </p>
                  );
                }
                return <div key={index} className="h-2" />;
              })}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              No scripts available
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Contact your manager to add a script
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
