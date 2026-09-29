import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { previewImport, runImport, type ImportPreview } from '@/lib/import';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [markdown, setMarkdown] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(file: File) {
    setFileName(file.name);
    setMarkdown(await file.text());
    setPreview(null);
  }

  async function handlePreview() {
    setBusy(true);
    try {
      setPreview(await previewImport(markdown));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    try {
      const result = await runImport(markdown, fileName ?? undefined);
      toast.success(
        `Imported ${result.added} new, updated ${result.updated}, ${result.categoriesCreated} categories created`,
      );
      setMarkdown('');
      setFileName(null);
      setPreview(null);
      onImported();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import bookmarks</DialogTitle>
          <DialogDescription>
            Paste or upload a markdown collection file. Headings become categories; bullets with URLs
            become bookmarks.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-file">Markdown file</Label>
            <Input
              id="import-file"
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void readFile(file);
                }
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-text">Or paste markdown</Label>
            <Textarea
              id="import-text"
              value={markdown}
              onChange={(event) => {
                setMarkdown(event.target.value);
                setPreview(null);
              }}
              placeholder={'## dev\n\n- some tool: https://example.com'}
              className="min-h-40 font-mono text-xs"
            />
          </div>

          {preview && (
            <p className="text-sm text-muted-foreground">
              Found {preview.parsed} bookmarks ({preview.skipped} skipped).
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handlePreview} disabled={busy || markdown.trim() === ''}>
            Preview
          </Button>
          <Button onClick={handleImport} disabled={busy || markdown.trim() === ''}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
