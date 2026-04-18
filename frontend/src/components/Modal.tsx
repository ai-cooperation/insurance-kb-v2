import React, { useEffect } from 'react';

interface ModalProps {
  readonly open: boolean;
  readonly onClose?: () => void;
  readonly children: React.ReactNode;
  readonly maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, children, maxWidth = 'max-w-2xl' }) => {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/50 backdrop-blur-sm" />
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${maxWidth} max-h-[85vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-2xl anim-in`}
      >
        {children}
      </div>
    </div>
  );
};
