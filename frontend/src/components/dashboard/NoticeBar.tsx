import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Info, AlertTriangle, CalendarOff, Zap, Pin,
  Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { Notice, NoticeType } from '@/lib/types';
import { fetchNotices, createNotice, updateNotice, deleteNotice } from '@/lib/api';
import { useHasPermission } from '@/lib/access';

const TYPE_CONFIG: Record<NoticeType, {
  icon: React.ElementType;
  label: string;
  dot: string;
  bg: string;
  border: string;
  text: string;
  badge: string;
  badgeBg: string;
}> = {
  info:    { icon: Info,          label: 'Info',    dot: '#38bdf8', bg: '#f0f9ff', border: '#bae6fd', text: '#0369a1', badge: '#0369a1', badgeBg: '#e0f2fe' },
  warning: { icon: AlertTriangle, label: 'Warning', dot: '#fbbf24', bg: '#fffbeb', border: '#fde68a', text: '#92400e', badge: '#92400e', badgeBg: '#fef3c7' },
  holiday: { icon: CalendarOff,   label: 'Holiday', dot: '#a78bfa', bg: '#faf5ff', border: '#ddd6fe', text: '#5b21b6', badge: '#5b21b6', badgeBg: '#ede9fe' },
  urgent:  { icon: Zap,           label: 'Urgent',  dot: '#fb7185', bg: '#fff1f2', border: '#fecdd3', text: '#9f1239', badge: '#9f1239', badgeBg: '#ffe4e6' },
};

const emptyForm = () => ({ title: '', message: '', type: 'info' as NoticeType, pinned: false, expiresAt: '' });

export function NoticeBar() {
  const canWrite = useHasPermission('notices:write');
  const [notices, setNotices]       = useState<Notice[]>([]);
  const [loading, setLoading]       = useState(true);
  const [idx, setIdx]               = useState(0);
  const [paused, setPaused]         = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState<Notice | null>(null);
  const [form, setForm]             = useState(emptyForm());
  const [saving, setSaving]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Notice | null>(null);
  const [deleting, setDeleting]     = useState(false);

  useEffect(() => {
    fetchNotices()
      .then(setNotices)
      .catch(() => toast.error('Failed to load notices'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (notices.length <= 1 || paused || dialogOpen) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % notices.length), 5000);
    return () => clearInterval(t);
  }, [notices.length, paused, dialogOpen]);

  if (loading) return null;
  if (notices.length === 0 && !canWrite) return null;

  const notice = notices[idx] ?? null;
  const cfg    = notice ? TYPE_CONFIG[notice.type] : null;
  const Icon   = cfg ? cfg.icon : null;

  function prev() { setIdx((i) => (i - 1 + notices.length) % notices.length); }
  function next() { setIdx((i) => (i + 1) % notices.length); }

  function openCreate() { setEditing(null); setForm(emptyForm()); setDialogOpen(true); }
  function openEdit(n: Notice) {
    setEditing(n);
    setForm({ title: n.title, message: n.message, type: n.type, pinned: n.pinned, expiresAt: format(parseISO(n.expiresAt), 'yyyy-MM-dd') });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim() || !form.message.trim() || !form.expiresAt) {
      toast.error('Title, message, and expiry date are required'); return;
    }
    setSaving(true);
    try {
      if (editing) {
        const updated = await updateNotice(editing.id, { ...form, expiresAt: new Date(form.expiresAt + 'T00:00:00').toISOString() });
        setNotices((p) => p.map((n) => (n.id === editing.id ? updated : n)));
        toast.success('Notice updated');
      } else {
        const created = await createNotice({ ...form, expiresAt: new Date(form.expiresAt + 'T00:00:00').toISOString() });
        setNotices((p) => [created, ...p]);
        setIdx(0);
        toast.success('Notice posted');
      }
      setDialogOpen(false);
    } catch { toast.error('Failed to save notice'); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteNotice(deleteTarget.id);
      const next = notices.filter((n) => n.id !== deleteTarget.id);
      setNotices(next);
      setIdx((i) => Math.min(i, Math.max(0, next.length - 1)));
      toast.success('Notice deleted');
    } catch { toast.error('Failed to delete notice'); }
    finally { setDeleting(false); setDeleteTarget(null); }
  }

  return (
    <>
      {/* ── Single-line compact bar ── */}
      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2"
        style={cfg ? { background: cfg.bg, border: `1px solid ${cfg.border}` } : { background: '#f8fafc', border: '1px solid #e2e8f0' }}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {/* Type dot + badge */}
        {cfg && Icon ? (
          <span
            className="flex items-center gap-1 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest"
            style={{ background: cfg.badgeBg, color: cfg.badge }}
          >
            <Icon style={{ width: 10, height: 10 }} />
            {cfg.label}
          </span>
        ) : (
          <span className="text-xs text-gray-400 shrink-0">No notices</span>
        )}

        {/* Divider */}
        {notice && <span className="text-gray-300 shrink-0">·</span>}

        {/* Title */}
        {notice && (
          <span className="text-xs font-semibold truncate" style={{ color: cfg!.text, minWidth: 0 }}>
            {notice.pinned && <Pin style={{ width: 9, height: 9, display: 'inline', marginRight: 3, transform: 'rotate(45deg)', verticalAlign: 'middle' }} />}
            {notice.title}
          </span>
        )}

        {/* Message preview */}
        {notice && (
          <span className="text-xs text-gray-400 truncate hidden md:block" style={{ minWidth: 0 }}>
            — {notice.message}
          </span>
        )}

        {/* Expiry */}
        {notice && (
          <span className="text-[10px] text-gray-400 shrink-0 hidden lg:block">
            expires {format(parseISO(notice.expiresAt), 'MMM d')}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Edit / Delete (write only) */}
        {canWrite && notice && (
          <>
            <button onClick={() => openEdit(notice)} className="p-1 rounded text-gray-400 hover:text-gray-700 transition-colors shrink-0">
              <Pencil style={{ width: 11, height: 11 }} />
            </button>
            <button onClick={() => setDeleteTarget(notice)} className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors shrink-0">
              <Trash2 style={{ width: 11, height: 11 }} />
            </button>
            <div className="w-px h-4 bg-gray-200 shrink-0" />
          </>
        )}

        {/* Counter + arrows */}
        {notices.length > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={prev} disabled={notices.length <= 1} className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors">
              <ChevronLeft style={{ width: 13, height: 13 }} />
            </button>
            <span className="text-[10px] text-gray-400 font-medium tabular-nums">{idx + 1}/{notices.length}</span>
            <button onClick={next} disabled={notices.length <= 1} className="p-0.5 rounded text-gray-400 hover:text-gray-700 disabled:opacity-30 transition-colors">
              <ChevronRight style={{ width: 13, height: 13 }} />
            </button>
          </div>
        )}

        {/* Post button */}
        {canWrite && (
          <>
            <div className="w-px h-4 bg-gray-200 shrink-0" />
            <button onClick={openCreate} className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors shrink-0">
              <Plus style={{ width: 11, height: 11 }} />
              Post
            </button>
          </>
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base font-semibold">{editing ? 'Edit Notice' : 'Post a Notice'}</DialogTitle>
              <button onClick={() => setDialogOpen(false)} className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
          </DialogHeader>
          <div className="px-6 py-5 space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Title *</Label>
              <Input placeholder="e.g. Office closed on Friday" value={form.title} className="rounded-xl h-9 text-sm" onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Message *</Label>
              <Textarea placeholder="Write the full announcement here..." rows={3} value={form.message} className="rounded-xl text-sm resize-none" onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as NoticeType }))}>
                  <SelectTrigger className="rounded-xl h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">Info</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                    <SelectItem value="holiday">Holiday</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Expiry Date *</Label>
                <Input type="date" value={form.expiresAt} className="rounded-xl h-9 text-sm" onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-gray-800">Pin this notice</p>
                <p className="text-xs text-gray-400">Appears first for everyone</p>
              </div>
              <Switch checked={form.pinned} onCheckedChange={(v) => setForm((f) => ({ ...f, pinned: v }))} />
            </div>
          </div>
          <DialogFooter className="px-6 py-4 border-t border-gray-100 flex gap-2">
            <Button variant="outline" className="flex-1 rounded-xl h-9 text-sm" onClick={() => setDialogOpen(false)} disabled={saving}>Cancel</Button>
            <Button className="flex-1 rounded-xl h-9 text-sm font-semibold bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 border-0" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
              {editing ? 'Save Changes' : 'Post Notice'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete notice?</AlertDialogTitle>
            <AlertDialogDescription>"{deleteTarget?.title}" will be removed for all employees immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="rounded-xl">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="rounded-xl bg-red-500 hover:bg-red-600">
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
