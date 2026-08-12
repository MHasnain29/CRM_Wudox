import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Pencil, Trash2, GripVertical, Workflow } from 'lucide-react';
import { PipelineStage } from '@/lib/types';

interface PipelineTabProps {
  pipelineStages: PipelineStage[];
  isAddStageOpen: boolean;
  setIsAddStageOpen: (open: boolean) => void;
  newStageLabel: string;
  setNewStageLabel: (label: string) => void;
  newStageColor: string;
  setNewStageColor: (color: string) => void;
  handleAddStage: () => void;
  isEditStageOpen: boolean;
  setIsEditStageOpen: (open: boolean) => void;
  editedStageLabel: string;
  setEditedStageLabel: (label: string) => void;
  editedStageColor: string;
  setEditedStageColor: (color: string) => void;
  handleEditStage: () => void;
  isDeleteStageOpen: boolean;
  setIsDeleteStageOpen: (open: boolean) => void;
  deletingStage: string;
  handleDeleteStage: () => void;
  openEditStageDialog: (stageId: string) => void;
  openDeleteStageDialog: (stageId: string) => void;
  handleDragStart: (stageId: string) => void;
  handleDragOver: (e: React.DragEvent, targetStageId: string) => void;
  handleDragEnd: () => void;
  draggedStage: string | null;
}

export function PipelineConfigTab(props: PipelineTabProps) {
  const {
    pipelineStages,
    isAddStageOpen,
    setIsAddStageOpen,
    newStageLabel,
    setNewStageLabel,
    newStageColor,
    setNewStageColor,
    handleAddStage,
    isEditStageOpen,
    setIsEditStageOpen,
    editedStageLabel,
    setEditedStageLabel,
    editedStageColor,
    setEditedStageColor,
    handleEditStage,
    isDeleteStageOpen,
    setIsDeleteStageOpen,
    deletingStage,
    handleDeleteStage,
    openEditStageDialog,
    openDeleteStageDialog,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    draggedStage,
  } = props;

  return (
    <TabsContent value="pipeline">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Workflow className="h-5 w-5" />
              Pipeline Configuration
            </CardTitle>
            <Dialog open={isAddStageOpen} onOpenChange={setIsAddStageOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Stage
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Pipeline Stage</DialogTitle>
                  <DialogDescription>
                    Create a new stage for your sales pipeline. The background will automatically be a lighter shade of your chosen color.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-stage-label">Stage Name</Label>
                    <Input
                      id="new-stage-label"
                      placeholder="e.g., Negotiation"
                      value={newStageLabel}
                      onChange={(e) => setNewStageLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddStage();
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-stage-color">Stage Color</Label>
                    <Input
                      id="new-stage-color"
                      type="color"
                      value={newStageColor}
                      onChange={(e) => setNewStageColor(e.target.value)}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddStageOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddStage}>Add Stage</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            Drag to reorder stages. The background color is automatically generated as a lighter shade. Closed Won and Closed Lost cannot be modified or reordered.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {pipelineStages.map((stage) => (
              <div
                key={stage.id}
                draggable={!stage.isFixed}
                onDragStart={() => handleDragStart(stage.id)}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragEnd={handleDragEnd}
                className={`flex items-center justify-between p-4 border rounded-lg transition-all ${
                  !stage.isFixed ? 'cursor-move hover:bg-accent/50' : 'opacity-60'
                } ${draggedStage === stage.id ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3">
                  {!stage.isFixed && <GripVertical className="h-4 w-4 text-muted-foreground" />}
                  <div 
                    className="w-4 h-4 rounded-full" 
                    style={{ backgroundColor: stage.color }}
                  />
                  <div>
                    <div className="font-medium">{stage.label}</div>
                    <div className="text-xs text-muted-foreground">{stage.color}</div>
                  </div>
                  {stage.isFixed && (
                    <Badge variant="secondary" className="ml-2 text-xs">Fixed</Badge>
                  )}
                </div>
                {!stage.isFixed && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditStageDialog(stage.id)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDeleteStageDialog(stage.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit Stage Dialog */}
      <Dialog open={isEditStageOpen} onOpenChange={setIsEditStageOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Pipeline Stage</DialogTitle>
            <DialogDescription>
              Update the stage name and color. The background will automatically be a lighter shade.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-stage-label">Stage Name</Label>
              <Input
                id="edit-stage-label"
                value={editedStageLabel}
                onChange={(e) => setEditedStageLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleEditStage();
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-stage-color">Stage Color</Label>
              <Input
                id="edit-stage-color"
                type="color"
                value={editedStageColor}
                onChange={(e) => setEditedStageColor(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditStageOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEditStage}>Update Stage</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Stage Confirmation */}
      <AlertDialog open={isDeleteStageOpen} onOpenChange={setIsDeleteStageOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pipeline Stage</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this stage? All leads in this stage will need to be reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteStage} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TabsContent>
  );
}