import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { colors } from '../theme';

interface ToastProps {
  message: string | null;
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ message, onDismiss, duration = 5000 }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [displayMsg, setDisplayMsg] = useState<string | null>(null);

  const dismiss = useCallback(() => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      setExiting(false);
      onDismiss();
    }, 280);
  }, [onDismiss]);

  useEffect(() => {
    if (message) {
      setDisplayMsg(message);
      setVisible(true);
      setExiting(false);
      const timer = setTimeout(dismiss, duration);
      return () => clearTimeout(timer);
    }
  }, [message, duration, dismiss]);

  if (!visible || !displayMsg) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 z-50 max-w-md pointer-events-auto"
      style={{
        transform: `translateX(-50%) translateY(${exiting ? '20px' : '0px'})`,
        opacity: exiting ? 0 : 1,
        transition: 'transform 280ms ease, opacity 280ms ease',
      }}
    >
      <div
        className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl"
        style={{
          background: 'rgba(8, 18, 32, 0.96)',
          border: '1px solid rgba(251, 191, 36, 0.2)',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <div
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(251, 191, 36, 0.1)' }}
        >
          <AlertTriangle size={14} style={{ color: '#fbbf24' }} />
        </div>
        <p className="text-[12px] leading-relaxed flex-1 min-w-0" style={{ color: colors.textSecondary }}>
          {displayMsg}
        </p>
        <button
          onClick={dismiss}
          className="shrink-0 p-1 rounded-lg transition-colors"
          style={{ color: colors.textDim }}
          onMouseEnter={(e) => { e.currentTarget.style.color = colors.textSecondary; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = colors.textDim; }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
}
