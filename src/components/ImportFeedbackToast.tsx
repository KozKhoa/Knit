import React from "react";
import { CheckCircle2 } from "lucide-react";

export interface ImportToastState {
  id: number;
  message: string;
}

export function useImportFeedback(durationMs = 1600) {
  const [toast, setToast] = React.useState<ImportToastState | null>(null);
  const [highlighted, setHighlighted] = React.useState(false);
  const timerRef = React.useRef<number | null>(null);

  const notifyImported = React.useCallback(
    (message: string) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      setToast({ id: Date.now(), message });
      setHighlighted(true);
      timerRef.current = window.setTimeout(() => {
        setToast(null);
        setHighlighted(false);
        timerRef.current = null;
      }, durationMs);
    },
    [durationMs],
  );

  React.useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { toast, highlighted, notifyImported };
}

export const ImportFeedbackToast: React.FC<{ toast: ImportToastState | null }> = ({
  toast,
}) => {
  if (!toast) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-50 flex max-w-sm items-center gap-2 rounded-[4px] border border-[#28A745] bg-[#D4EDDA] px-3.5 py-2 text-xs font-semibold text-[#155724] shadow-lg"
    >
      <CheckCircle2 className="h-4 w-4 shrink-0 text-[#28A745]" />
      <span className="truncate">{toast.message}</span>
    </div>
  );
};
