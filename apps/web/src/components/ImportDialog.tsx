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
import {
  commitImport,
  extractImport,
  type ImportPreview,
} from '@/lib/client';

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export function ImportDialog({ open, onOpenChange, onImported }: ImportDialogProps) {
  const [markdown, setMarkdown] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function readFile(file: File) {
    setMarkdown(await file.text());
    setPreview(null);
  }

  async function handleExtract() {
    setBusy(true);
    try {
      const result = await extractImport(markdown);
      setPreview(result);
      if (result.warnings && result.warnings.length > 0) {
        for (const warning of result.warnings) {
          toast.warning(warning);
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Extract failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport() {
    setBusy(true);
    try {
      const result = await commitImport(markdown);
      toast.success(
        `Imported ${result.bookmarks.length} bookmarks (${result.provider === 'llm' ? 'LLM' : 'parser'})`,
      );
      setMarkdown('');
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
            Paste or upload any text. The LLM extractor will pull out URLs, titles, and tags;
            the deterministic parser is used as a fallback when no model is configured.
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
            <Label htmlFor="import-text">Or paste text</Label>
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
              {preview.bookmarks.length} bookmarks via {preview.provider}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleExtract}
            disabled={busy || markdown.trim() === ''}
          >
            Extract
          </Button>
          <Button onClick={handleImport} disabled={busy || markdown.trim() === ''}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
