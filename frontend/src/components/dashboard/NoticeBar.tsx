import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  Info, AlertTriangle, CalendarOff, Zap, Pin, Megaphone,
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
  const [viewOpen, setViewOpen]     = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing]       = useState<Notice | null>(null);
  const [form, setForm]             = useState(emptyForm());
  const [saving, setSaving]         = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Notice | null>(null);
  const [deleting, setDeleting]     = useState(false);

  useEffect(() => {
    fetchNotices()
      .then(setNotices)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);


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
      {/* Per-type glow keyframes */}
      {notice && (
        <style>{`
          @keyframes nbGlowHoliday {
            0%,100% { box-shadow: 0 0 0 0 rgba(167,139,250,0.4); }
            50%      { box-shadow: 0 0 0 7px rgba(167,139,250,0); }
          }
          @keyframes nbGlowUrgent {
            0%,100% { box-shadow: 0 0 0 0 rgba(251,113,133,0.45); }
            50%      { box-shadow: 0 0 0 8px rgba(251,113,133,0); }
          }
          @keyframes nbGlowWarning {
            0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,0.4); }
            50%      { box-shadow: 0 0 0 7px rgba(251,191,36,0); }
          }
          @keyframes nbGlowInfo {
            0%,100% { box-shadow: 0 0 0 0 rgba(56,189,248,0.35); }
            50%      { box-shadow: 0 0 0 6px rgba(56,189,248,0); }
          }
          .nb-bar-holiday { animation: nbGlowHoliday 2s ease-in-out infinite; }
          .nb-bar-urgent  { animation: nbGlowUrgent  1.2s ease-in-out infinite; }
          .nb-bar-warning { animation: nbGlowWarning 1.8s ease-in-out infinite; }
          .nb-bar-info    { animation: nbGlowInfo    2.5s ease-in-out infinite; }
        `}</style>
      )}

      <div
        className={`mt-3 rounded-2xl px-4 py-3 shadow-sm${notice ? ` nb-bar-${notice.type}` : ''}`}
        style={cfg ? { background: cfg.bg, border: `1.5px solid ${cfg.border}` } : { background: 'hsl(217 91% 97%)', border: '1.5px dashed hsl(217 91% 82%)' }}
      >
        {/* Top row: label + controls */}
        <div className="flex items-center gap-3">
          {/* Badge */}
          {cfg && Icon ? (
            <span
              className="flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-widest"
              style={{ background: cfg.badgeBg, color: cfg.badge }}
            >
              <Icon style={{ width: 12, height: 12 }} />
              {cfg.label}
            </span>
          ) : (
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="relative shrink-0">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary">
                  <Megaphone style={{ width: 13, height: 13, color: 'white' }} />
                </div>
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400" style={{ border: '1.5px solid white' }} />
              </div>
              <span className="text-sm font-semibold text-primary">No notices yet</span>
              <span className="text-xs text-muted-foreground hidden sm:inline">· Post an update to keep your team in the loop</span>
            </div>
          )}

          {/* Divider dot */}
          {notice && <span className="text-gray-300 shrink-0 text-lg leading-none">·</span>}

          {/* Title — clickable */}
          {notice && (
            <button
              className="min-w-0 flex-1 text-left hover:opacity-75 transition-opacity"
              onClick={() => setViewOpen(true)}
            >
              <span className="text-sm font-semibold truncate block" style={{ color: cfg!.text }}>
                {notice.pinned && <Pin style={{ width: 10, height: 10, display: 'inline', marginRight: 4, transform: 'rotate(45deg)', verticalAlign: 'middle' }} />}
                {notice.title}
              </span>
            </button>
          )}

          {/* Spacer (only needed when notice is shown, empty state uses flex-1 internally) */}

          {/* Edit / Delete */}
          {canWrite && notice && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => openEdit(notice)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-black/5 transition-colors">
                <Pencil style={{ width: 12, height: 12 }} />
              </button>
              <button onClick={() => setDeleteTarget(notice)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                <Trash2 style={{ width: 12, height: 12 }} />
              </button>
              <div className="w-px h-5 bg-gray-200 mx-1" />
            </div>
          )}

          {/* Counter + arrows */}
          {notices.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={prev} disabled={notices.length <= 1} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-black/5 disabled:opacity-30 transition-colors">
                <ChevronLeft style={{ width: 15, height: 15 }} />
              </button>
              <span className="text-xs text-gray-400 font-medium tabular-nums w-8 text-center">{idx + 1}/{notices.length}</span>
              <button onClick={next} disabled={notices.length <= 1} className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-black/5 disabled:opacity-30 transition-colors">
                <ChevronRight style={{ width: 15, height: 15 }} />
              </button>
            </div>
          )}

          {/* Post button */}
          {canWrite && (
            <>
              {notice && <div className="w-px h-5 bg-gray-200 shrink-0" />}
              {notice ? (
                <button onClick={openCreate} className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors shrink-0 px-1">
                  <Plus style={{ width: 13, height: 13 }} />
                  Post
                </button>
              ) : (
                <button
                  onClick={openCreate}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-white rounded-full shrink-0 px-3 py-1.5 transition-all hover:bg-white/90 active:scale-95 shadow-sm"
                >
                  <Plus style={{ width: 12, height: 12 }} />
                  Post Notice
                </button>
              )}
            </>
          )}
        </div>

        {/* Message preview row */}
        {notice && (
          <button
            className="w-full text-left mt-1.5 hover:opacity-75 transition-opacity"
            onClick={() => setViewOpen(true)}
          >
            <p className="text-xs text-gray-500 line-clamp-1 leading-relaxed">
              {notice.message}
              <span className="ml-2 text-[10px] font-medium" style={{ color: cfg!.badge }}>
                expires {format(parseISO(notice.expiresAt), 'MMM d')}
              </span>
            </p>
          </button>
        )}
      </div>

      {/* Notice detail view popup */}
      {viewOpen && notice && cfg && (() => {
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
            onClick={() => setViewOpen(false)}
          >
            <style>{`
              @keyframes noticePopIn {
                0%   { opacity: 0; transform: scale(0.85) translateY(20px); }
                60%  { transform: scale(1.03) translateY(-4px); }
                100% { opacity: 1; transform: scale(1) translateY(0); }
              }
              @keyframes shimmer {
                0%, 100% { opacity: 0.7; }
                50%       { opacity: 1; }
              }
              .notice-pop-in { animation: noticePopIn 0.38s cubic-bezier(0.34,1.56,0.64,1) forwards; }
              .shimmer-badge { animation: shimmer 2s ease-in-out infinite; }
            `}</style>

            <div
              className="notice-pop-in relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
              style={{ background: cfg.bg, border: `2px solid ${cfg.border}` }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="relative px-6 pt-6 pb-4">
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="shimmer-badge flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest"
                    style={{ background: cfg.badgeBg, color: cfg.badge }}
                  >
                    {cfg.icon && <cfg.icon style={{ width: 12, height: 12 }} />}
                    {cfg.label}
                  </span>
                  <button
                    onClick={() => setViewOpen(false)}
                    className="h-7 w-7 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-black/10 transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <h2 className="mt-4 text-xl font-bold leading-snug" style={{ color: cfg.text }}>
                  {notice.pinned && (
                    <Pin style={{ width: 14, height: 14, display: 'inline', marginRight: 6, transform: 'rotate(45deg)', verticalAlign: 'middle' }} />
                  )}
                  {notice.title}
                </h2>
              </div>

              {/* Divider */}
              <div style={{ height: 1, background: cfg.border, margin: '0 24px' }} />

              {/* Body */}
              <div className="px-6 py-5">
                <p className="text-sm leading-relaxed" style={{ color: cfg.text, opacity: 0.85 }}>
                  {notice.message}
                </p>
              </div>

              {/* Footer */}
              <div
                className="flex items-center justify-between px-6 py-3 text-xs"
                style={{ background: cfg.badgeBg, color: cfg.badge }}
              >
                <span>Expires {format(parseISO(notice.expiresAt), 'dd MMM yyyy')}</span>
                {canWrite && (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { setViewOpen(false); openEdit(notice); }}
                      className="font-semibold hover:opacity-70 transition-opacity"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => { setViewOpen(false); setDeleteTarget(notice); }}
                      className="font-semibold text-red-500 hover:opacity-70 transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px] rounded-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-gray-100">
            <DialogTitle className="text-base font-semibold">{editing ? 'Edit Notice' : 'Post a Notice'}</DialogTitle>
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
            <Button className="flex-1" onClick={handleSave} disabled={saving}>
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
