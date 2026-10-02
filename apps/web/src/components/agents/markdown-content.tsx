"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { memo } from "react";
import type { Components } from "react-markdown";

import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  children: string;
  className?: string;
}

const markdownComponents: Components = {
  a: ({ node: _node, className, ...props }) => (
    <a
      className={cn(
        "font-medium text-primary underline underline-offset-4 transition-colors hover:text-primary/80",
        className,
      )}
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  table: ({ node: _node, className, children, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table
        className={cn("w-full border-collapse text-sm", className)}
        {...props}
      >
        {children}
      </table>
    </div>
  ),
};

function MarkdownContentBase({ children, className }: MarkdownContentProps) {
  // ReactMarkdown's Options has no className prop — the styling lives on this
  // wrapper instead (all rules are arbitrary-variant descendant selectors, so
  // moving them up a level is equivalent).
  return (
    <div
      className={cn(
        "text-sm leading-6 text-foreground/90 break-words",
        "[&_p+p]:mt-3",
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/45 [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
        "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
        "[&_li]:text-foreground/90",
        "[&_h1]:my-3 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground",
        "[&_h2]:my-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground",
        "[&_h3]:my-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground",
        "[&_h4]:my-2 [&_h4]:text-sm [&_h4]:font-medium [&_h4]:text-muted-foreground",
        "[&_thead]:bg-muted",
        "[&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1",
        "[&_hr]:my-3 [&_hr]:border-border",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownContent = memo(MarkdownContentBase, (prev, next) => (
  prev.children === next.children && prev.className === next.className
));
