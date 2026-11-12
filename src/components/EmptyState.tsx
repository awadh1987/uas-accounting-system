"use client";

import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, description, action, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div className="py-10 px-4 text-center space-y-2.5">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto">
        <Inbox className="w-6 h-6" />
      </div>
      <div className="text-xs font-extrabold text-slate-600 dark:text-slate-300">{title}</div>
      {description && (
        <p className="text-[11px] text-slate-400 max-w-sm mx-auto">{description}</p>
      )}
      {action && <div className="pt-1">{action}</div>}
      {!action && actionLabel && onAction && (
        <div className="pt-1">
          <button
            type="button"
            onClick={onAction}
            className="px-4 py-2 rounded-xl accent-bg text-xs font-extrabold"
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

