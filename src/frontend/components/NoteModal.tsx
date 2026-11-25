/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useId } from 'react';
import {
  X,
  FileText,
  Plus,
  Trash2,
  AlertCircle,
  Edit3,
  Check,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import {
  APPROACH_DEFAULT_TEMPLATE,
  type ProblemAggregate,
  type Approach,
  AppError,
  checkEnrollmentGate,
} from '../../domain/index.js';
import { apiClient } from '../apiClient.js';

export interface NoteModalProps {
  readonly aggregate: ProblemAggregate | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

interface ApproachDraft {
  id: string;
  title: string;
  body: string;
}

export const NoteModal: React.FC<NoteModalProps> = ({
  aggregate,
  isOpen,
  onClose,
  onSaved,
}) => {
  const dialogId = useId();
  const [approaches, setApproaches] = useState<ApproachDraft[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);
  const [editingTabTitleId, setEditingTabTitleId] = useState<string | null>(null);
  const [tabTitleInput, setTabTitleInput] = useState<string>('');
  const [saving, setSaving] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fontStyle, setFontStyle] = useState<'sans' | 'serif' | 'code'>('sans');
  const [fontSize, setFontSize] = useState<'compact' | 'comfortable' | 'large'>('comfortable');
  const fontFamilies = { sans: 'Inter, ui-sans-serif, system-ui, sans-serif', serif: 'Georgia, Cambria, serif', code: 'ui-monospace, SFMono-Regular, Consolas, monospace' };
  const fontSizes = { compact: '14px', comfortable: '16px', large: '18px' };

  // Initialize draft when modal opens or aggregate changes
  useEffect(() => {
    if (aggregate) {
      setErrorMessage(null);
      setIsDirty(false);
      setShowDiscardConfirm(false);
      setEditingTabTitleId(null);

      const existingApproaches = aggregate.note?.approaches || [];
      if (existingApproaches.length > 0) {
        const drafts: ApproachDraft[] = existingApproaches.map((app) => ({
          id: app.id,
          title: app.title,
          body: app.body,
        }));
        setApproaches(drafts);
        setActiveTabId(drafts[0].id);
        // Default to View mode when opening existing notes
        setIsEditing(false);
      } else {
        // Brand new note: start with Approach 1 prefilled with template in Edit mode
        const initialDraft: ApproachDraft = {
          id: 'approach-1',
          title: 'Approach 1',
          body: APPROACH_DEFAULT_TEMPLATE,
        };
        setApproaches([initialDraft]);
        setActiveTabId(initialDraft.id);
        setIsEditing(true);
      }
    }
  }, [aggregate, isOpen]);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (showDiscardConfirm) {
          setShowDiscardConfirm(false);
        } else if (isDirty) {
          setShowDiscardConfirm(true);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDirty, showDiscardConfirm, onClose]);

  if (!isOpen || !aggregate) return null;

  const isInbox = aggregate.problem.status === 'INBOX';
  const activeApproach =
    approaches.find((a) => a.id === activeTabId) || approaches[0] || {
      id: 'approach-1',
      title: 'Approach 1',
      body: APPROACH_DEFAULT_TEMPLATE,
    };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newBody = e.target.value;
    setApproaches((prev) =>
      prev.map((app) => (app.id === activeApproach.id ? { ...app, body: newBody } : app))
    );
    setIsDirty(true);
    setErrorMessage(null);
  };

  const handleAddApproach = () => {
    const newIndex = approaches.length + 1;
    const newId = `approach-${Date.now()}`;
    const newApproach: ApproachDraft = {
      id: newId,
      title: `Approach ${newIndex}`,
      body: APPROACH_DEFAULT_TEMPLATE,
    };

    setApproaches((prev) => [...prev, newApproach]);
    setActiveTabId(newId);
    setIsEditing(true);
    setIsDirty(true);
    setErrorMessage(null);
  };

  const handleDeleteApproach = (idToDelete: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (approaches.length <= 1) return; // Cannot delete the last tab

    const newApproaches = approaches.filter((a) => a.id !== idToDelete);
    setApproaches(newApproaches);
    if (activeTabId === idToDelete) {
      setActiveTabId(newApproaches[0].id);
    }
    setIsDirty(true);
  };

  const handleStartRenameTab = (app: ApproachDraft, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTabTitleId(app.id);
    setTabTitleInput(app.title);
  };

  const handleFinishRenameTab = () => {
    if (!editingTabTitleId) return;
    const cleanTitle = tabTitleInput.trim() || 'Approach';
    setApproaches((prev) =>
      prev.map((app) => (app.id === editingTabTitleId ? { ...app, title: cleanTitle } : app))
    );
    setEditingTabTitleId(null);
    setIsDirty(true);
  };

  const handleAttemptClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setErrorMessage(null);

    const payload: Approach[] = approaches.map((app) => ({
      id: app.id,
      title: app.title.trim() || 'Approach',
      body: app.body,
    }));

    // If problem is in INBOX, client-side gate validation check before sending
    if (isInbox) {
      const gate = checkEnrollmentGate(payload);
      if (!gate.isValid) {
        setErrorMessage(
          gate.error ||
            'Approach 1 requires both Time Complexity and Space Complexity with non-empty values.'
        );
        setSaving(false);
        // Switch to Approach 1 and edit mode so user can immediately correct it
        setActiveTabId(approaches[0].id);
        setIsEditing(true);
        return;
      }
    }

    try {
      await apiClient.saveNote(aggregate.problem.id, payload);
      setIsDirty(false);
      onSaved();
      onClose();
    } catch (err: unknown) {
      if (err instanceof AppError) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Failed to save note.');
      }
    } finally {
      setSaving(false);
    }
  };

  // View Mode Renderer: React nodes with 32px complexity labels via token
  const renderViewMode = (content: string) => {
    const lines = content.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Check Time Complexity
      const isTimeComplexity = /^Time\s+Complexity\s*:/i.test(trimmed);
      const isSpaceComplexity = /^Space\s+Complexity\s*:/i.test(trimmed);

      if (isTimeComplexity || isSpaceComplexity) {
        const labelText = isTimeComplexity ? 'Time Complexity' : 'Space Complexity';
        const afterColon = trimmed.replace(/^(Time|Space)\s+Complexity\s*:\s*/i, '');

        nodes.push(
          <div key={`compl-${i}`} className="my-5 p-4 rounded-xl bg-zinc-950/70 border border-zinc-800">
            <span
              className="font-bold text-amber-400 block tracking-tight"
              style={{ fontSize: '20px', lineHeight: 1.3 }}
            >
              {labelText}
            </span>
            <div className="mt-2 text-zinc-200 font-medium" style={{ fontSize: '0.92em' }}>
              {afterColon || <span className="text-zinc-500 italic">Not specified</span>}
            </div>
          </div>
        );
        i++;
        continue;
      }

      // Check other template labels
      const matchedOtherLabel = ['Your approach:', 'Actual approach:', 'Mistakes:'].find((lbl) =>
        trimmed.toLowerCase().startsWith(lbl.toLowerCase())
      );

      if (matchedOtherLabel) {
        const afterColon = trimmed.slice(matchedOtherLabel.length).trim();
        nodes.push(
          <div key={`lbl-${i}`} className="my-3">
            <span className="text-xs uppercase tracking-wider font-bold text-zinc-400 block mb-1">
              {matchedOtherLabel}
            </span>
            <div className="text-zinc-200 leading-relaxed whitespace-pre-wrap">
              {afterColon || <span className="text-zinc-500 italic">None noted</span>}
            </div>
          </div>
        );
        i++;
        continue;
      }

      // Regular line of text
      if (trimmed.length > 0) {
        nodes.push(
          <p key={`line-${i}`} className="text-zinc-300 my-1.5 leading-relaxed whitespace-pre-wrap">
            {line}
          </p>
        );
      } else {
        nodes.push(<div key={`empty-${i}`} className="h-2" />);
      }
      i++;
    }

    return <div className="space-y-1">{nodes}</div>;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${dialogId}-title`}
    >
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-4xl w-full p-6 shadow-2xl relative flex flex-col h-[85vh] max-h-[850px] min-h-[550px] transition-all duration-200 motion-reduce:transition-none">
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shadow-inner">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 id={`${dialogId}-title`} className="text-lg font-bold text-zinc-100">
                  Notes
                </h2>
                <span className="text-zinc-500 font-mono text-xs">/</span>
                <span className="text-sm font-semibold text-zinc-300 truncate max-w-sm">
                  {aggregate.problem.title}
                </span>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                    aggregate.problem.difficulty === 'Easy'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : aggregate.problem.difficulty === 'Medium'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  }`}
                >
                  {aggregate.problem.difficulty}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {isInbox
                  ? 'Approach 1 must contain Time & Space Complexity to enroll into the 1, 3, 7 day review schedule.'
                  : 'Document multiple approaches and review your algorithmic complexity anytime.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* View / Edit Mode Toggle Button */}
            <button
              type="button"
              onClick={() => setIsEditing(!isEditing)}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition cursor-pointer"
            >
              {isEditing ? (
                <>
                  <Eye className="w-3.5 h-3.5 text-amber-400" />
                  <span>View Mode</span>
                </>
              ) : (
                <>
                  <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                  <span>Edit Notes</span>
                </>
              )}
            </button>

            {/* + Add approach button at the top right of the header */}
            <button
              type="button"
              onClick={handleAddApproach}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold transition shadow-sm cursor-pointer"
              aria-label="Add new approach tab"
            >
              <Plus className="w-4 h-4" />
              <span>+ Add approach</span>
            </button>

            {/* Close button */}
            <button
              type="button"
              onClick={handleAttemptClose}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition cursor-pointer"
              aria-label="Close notes modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Inline Error Banner */}
        {errorMessage && (
          <div className="my-3 p-3 rounded-xl bg-rose-950/50 border border-rose-900/80 text-xs text-rose-300 flex items-start space-x-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{errorMessage}</div>
          </div>
        )}

        {/* Tab Strip with in-place transition */}
        <div
          role="tablist"
          aria-label="Approach tabs"
          className="flex items-center space-x-1 border-b border-zinc-800 pt-3 pb-0 overflow-x-auto transition-all duration-200 motion-reduce:transition-none"
        >
          {approaches.map((app) => {
            const isActive = app.id === activeApproach.id;
            const isEditingTitle = editingTabTitleId === app.id;

            return (
              <div
                key={app.id}
                role="tab"
                id={`tab-${app.id}`}
                aria-selected={isActive}
                aria-controls={`panel-${app.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActiveTabId(app.id)}
                className={`group flex items-center space-x-2 px-3.5 py-2 text-xs font-semibold rounded-t-lg border-b-2 cursor-pointer transition select-none ${
                  isActive
                    ? 'bg-zinc-800 text-amber-400 border-amber-400 font-bold'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
                }`}
              >
                {isEditingTitle ? (
                  <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={tabTitleInput}
                      onChange={(e) => setTabTitleInput(e.target.value)}
                      onBlur={handleFinishRenameTab}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleFinishRenameTab();
                        if (e.key === 'Escape') setEditingTabTitleId(null);
                      }}
                      autoFocus
                      className="bg-zinc-950 border border-amber-500 rounded px-1.5 py-0.5 text-xs text-zinc-100 font-semibold focus:outline-none w-28"
                    />
                    <button
                      type="button"
                      onClick={handleFinishRenameTab}
                      className="text-amber-400 hover:text-amber-300"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <span
                    onDoubleClick={(e) => handleStartRenameTab(app, e)}
                    title="Double-click to rename tab"
                    className="truncate max-w-[150px]"
                  >
                    {app.title}
                  </span>
                )}

                {/* Tab actions */}
                {!isEditingTitle && (
                  <div className="flex items-center space-x-1 opacity-60 group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => handleStartRenameTab(app, e)}
                      className="p-0.5 hover:text-amber-400 text-zinc-400 transition"
                      title="Rename tab"
                      aria-label={`Rename ${app.title}`}
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>

                    {approaches.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteApproach(app.id, e)}
                        className="p-0.5 hover:text-rose-400 text-zinc-400 transition"
                        title="Delete approach tab"
                        aria-label={`Delete ${app.title}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Reading controls and note editor */}
        <div
          role="tabpanel"
          id={`panel-${activeApproach.id}`}
          aria-labelledby={`tab-${activeApproach.id}`}
          className="flex-1 flex flex-col min-h-0 pt-3 relative"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 px-3 py-2">
            <div className="flex items-center gap-1.5" aria-label="Note font">
              {(['sans', 'serif', 'code'] as const).map((font) => <button key={font} type="button" aria-pressed={fontStyle === font} onClick={() => setFontStyle(font)} className={`rounded-lg px-3 py-1.5 text-xs capitalize transition ${fontStyle === font ? 'bg-amber-400/15 text-amber-300' : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'}`}>{font === 'sans' ? 'Clean' : font === 'serif' ? 'Classic' : 'Code'}</button>)}
            </div>
            <div className="flex items-center gap-1.5" aria-label="Text size">
              {(['compact', 'comfortable', 'large'] as const).map((size, i) => <button key={size} type="button" aria-label={`${size} text`} aria-pressed={fontSize === size} onClick={() => setFontSize(size)} className={`rounded-lg px-2.5 py-1.5 text-xs transition ${fontSize === size ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'}`}>{['A', 'A', 'A'][i]}{i === 2 ? '+' : ''}</button>)}
            </div>
          </div>
          {isEditing ? (
            <div className="relative flex-1 min-h-0 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden focus-within:border-amber-500 transition">
              <textarea
                value={activeApproach.body}
                onChange={handleBodyChange}
                rows={16}
                aria-label="Approach notes editor"
                placeholder="Write your approach notes here…"
                className="absolute inset-0 h-full w-full resize-none border-0 bg-transparent p-5 leading-7 text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
                style={{ fontFamily: fontFamilies[fontStyle], fontSize: fontSizes[fontSize] }}
              />
            </div>
          ) : (
            /* View Mode: React Nodes with 32px token for complexity labels */
            <div className="flex-1 min-h-0 rounded-xl border border-zinc-800 bg-zinc-950 p-6 overflow-y-auto" style={{ fontFamily: fontFamilies[fontStyle], fontSize: fontSizes[fontSize] }}>
              {renderViewMode(activeApproach.body)}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between pt-4 mt-3 border-t border-zinc-800">
          <div className="flex items-center space-x-2 text-xs">
            {isDirty ? (
              <span className="flex items-center space-x-1.5 text-amber-400 font-medium">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Unsaved changes</span>
              </span>
            ) : (
              <span className="text-zinc-500">All changes saved</span>
            )}
            <span className="text-zinc-600">·</span>
            <span className="text-zinc-400">
              {isInbox ? 'Saving enrolls problem into Day 1, 3, 7 review schedule.' : 'Available in all dashboard views.'}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={handleAttemptClose}
              className="px-4 py-2 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold transition cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs transition shadow-sm disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Saving...' : isInbox ? 'Save & Enroll' : 'Save Notes'}
            </button>
          </div>
        </div>

        {/* Discard Confirmation Modal */}
        {showDiscardConfirm && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-xs rounded-2xl flex items-center justify-center p-6 z-50">
            <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 max-w-sm w-full shadow-2xl">
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <h4 className="text-sm font-bold text-zinc-100">Discard unsaved changes?</h4>
              </div>
              <p className="text-xs text-zinc-400 mb-4">
                You have unsaved changes in your approach notes. If you close without saving, these changes will be lost.
              </p>
              <div className="flex items-center justify-end space-x-2">
                <button
                  type="button"
                  onClick={() => setShowDiscardConfirm(false)}
                  className="px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold"
                >
                  Keep Editing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowDiscardConfirm(false);
                    setIsDirty(false);
                    onClose();
                  }}
                  className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
