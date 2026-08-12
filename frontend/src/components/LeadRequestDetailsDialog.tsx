import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { useStore } from '@/lib/store';
import { LeadRequest } from '@/lib/types';
import { format } from 'date-fns';
import { MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { addLeadRequestCommentApi } from '@/lib/api';

const commentSchema = z.object({
  comment: z.string().min(1, 'Comment cannot be empty'),
});

type CommentFormData = z.infer<typeof commentSchema>;

interface LeadRequestDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: LeadRequest | null;
}

export function LeadRequestDetailsDialog({ open, onOpenChange, request }: LeadRequestDetailsDialogProps) {
  const { addLeadRequestComment } = useStore();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localComments, setLocalComments] = useState<Array<{ id: string; userName: string; text: string; createdAt: string }>>([]);

  // Sync local comments whenever the request prop updates (e.g. after socket refresh)
  useEffect(() => {
    setLocalComments(request?.comments ?? []);
  }, [request?.id, request?.comments?.length]);

  const form = useForm<CommentFormData>({
    resolver: zodResolver(commentSchema),
    defaultValues: {
      comment: '',
    },
  });

  const onSubmit = async (data: CommentFormData) => {
    if (!request) return;
    setIsSubmitting(true);
    try {
      const saved = await addLeadRequestCommentApi(request.id, data.comment);
      // Instant UI update — socket will sync the rest
      setLocalComments((prev) => [...prev, { id: saved.id, userName: saved.userName, text: saved.text, createdAt: saved.createdAt }]);
      addLeadRequestComment(request.id, saved.text);
      form.reset();
      toast.success('Comment added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!request) return null;

  const statusVariant = 
    request.status === 'approved' ? 'default' :
    request.status === 'rejected' ? 'destructive' : 
    'secondary';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[650px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle>Lead Request Details</DialogTitle>
            <Badge variant={statusVariant}>
              {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
            </Badge>
          </div>
          <DialogDescription>
            Requested on {format(new Date(request.requestedAt), 'MMM d, yyyy h:mm a')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Request Information */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Requested By</p>
              <Input value={request.requestedByName} disabled />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Manager</p>
              <Input value={request.managerName} disabled />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Client Name</p>
              <Input value={request.clientName} disabled />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">Primary Contact</p>
              <Input value={request.primaryContactName} disabled />
            </div>
          </div>

          {request.reviewedBy && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-1">
                Reviewed By
              </p>
              <div className="text-sm">
                {request.reviewedByName} on {format(new Date(request.reviewedAt!), 'MMM d, yyyy h:mm a')}
              </div>
            </div>
          )}

          <Separator />

          {/* Comments Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="h-4 w-4" />
              <h3 className="font-semibold">Comments & Activity</h3>
            </div>

            <div className="space-y-3 mb-4">
              {localComments.map((comment) => (
                <Card key={comment.id} className="border-none shadow-sm">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-sm">{comment.userName}</p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(comment.createdAt), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm mt-2">{comment.text}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Add Comment Form */}
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
                <FormField
                  control={form.control}
                  name="comment"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Add Comment</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Add a comment..."
                          className="min-h-[80px]"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end gap-2">
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => onOpenChange(false)}
                  >
                    Close
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Adding...' : 'Add Comment'}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
