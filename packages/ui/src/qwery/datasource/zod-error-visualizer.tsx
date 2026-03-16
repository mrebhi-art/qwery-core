'use client';

import * as React from 'react';
import { AlertCircle } from 'lucide-react';
import type { ZodError, ZodIssue } from 'zod';
import { cn } from '@qwery/ui/utils';

interface ZodErrorVisualizerProps {
  error: ZodError | null;
  className?: string;
  title?: string;
}

export function ZodErrorVisualizer({
  error,
  className,
  title = 'Check the following',
}: ZodErrorVisualizerProps) {
  if (!error || error.issues.length === 0) {
    return null;
  }

  const issuesByPath = error.issues.reduce<Record<string, ZodIssue[]>>(
    (acc, issue) => {
      const path = issue.path.join('.') || '_root';
      const list = acc[path] ?? [];
      list.push(issue);
      acc[path] = list;
      return acc;
    },
    {},
  );

  const messages = Object.entries(issuesByPath).flatMap(([, issues]) =>
    issues.map((i) => i.message),
  );
  const uniqueMessages = [...new Set(messages)];

  return (
    <div
      className={cn(
        'border-destructive/30 bg-destructive/5 text-destructive dark:bg-destructive/10 flex gap-3 rounded-lg border-l-4 px-3 py-2.5 dark:text-red-400',
        className,
      )}
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="font-medium">{title}</p>
        <ul className="text-destructive/90 list-inside list-disc space-y-0.5 dark:text-red-400/90">
          {uniqueMessages.map((msg, i) => (
            <li key={i}>{msg}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
