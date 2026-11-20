"use client";

import React, { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import type { TabId, LanguageCode } from "@/types/uas";

interface Props {
  tab: TabId;
  lang: LanguageCode;
  onNavigateHome: () => void;
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class TabErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[UAS TabErrorBoundary] Error in tab "${this.props.tab}":`, error, errorInfo);
  }

  public handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      const isAr = this.props.lang === "ar";
      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 rounded-2xl p-6 shadow-xl text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-600 dark:text-rose-400">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {isAr ? "تعذر تحميل هذا القسم" : "Failed to load section"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {isAr
                  ? `حدث خطأ أثناء عرض قسم (${this.props.tab}). البيانات في وضع آمن ولم يتأثر النظام المالي.`
                  : `An error occurred while loading module (${this.props.tab}). Your financial data is safe.`}
              </p>
              {this.state.error?.message && (
                <div className="mt-3 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-[11px] font-mono text-rose-700 dark:text-rose-300 text-left overflow-x-auto">
                  {this.state.error.message}
                </div>
              )}
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{isAr ? "إعادة المحاولة" : "Retry"}</span>
              </button>
              <button
                type="button"
                onClick={this.props.onNavigateHome}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
              >
                <Home className="w-3.5 h-3.5" />
                <span>{isAr ? "العودة للرئيسية" : "Home"}</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
