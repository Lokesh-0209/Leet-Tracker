/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface DeleteConfirmModalProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly message: string;
  readonly isPermanent?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  title,
  message,
  isPermanent = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative">
        <button
          type="button"
          onClick={onCancel}
          className="absolute right-4 top-4 text-zinc-500 hover:text-zinc-300"
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center ${
              isPermanent ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
            }`}
          >
            {isPermanent ? <Trash2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </div>
          <div>
            <h3 id="delete-dialog-title" className="text-base font-bold text-zinc-100">
              {title}
            </h3>
            <p className="text-xs text-zinc-400">Please confirm this action</p>
          </div>
        </div>

        <p className="text-sm text-zinc-300 mb-6">{message}</p>

        <div className="flex items-center justify-end space-x-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition cursor-pointer ${
              isPermanent
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-amber-600 hover:bg-amber-500 text-zinc-950 font-bold'
            }`}
          >
            {isPermanent ? 'Permanently Delete' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
};
