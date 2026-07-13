import type React from 'react';

/**
 * The set of icons the body-editor toolbar can render. Each maps to a small inline
 * SVG in {@link Icon} — inline so the toolbar carries no icon-font/asset dependency
 * (SPEC's browser-native, zero-native-dependency principle) and inherits `currentColor`.
 */
export type IconName =
  | 'undo'
  | 'redo'
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'paragraph'
  | 'bulletList'
  | 'orderedList'
  | 'quote'
  | 'codeBlock'
  | 'hr'
  | 'table'
  | 'image';

export interface ToolbarAction {
  /** Accessible name + tooltip base (e.g. "Bold"). */
  label: string;
  /** Optional keyboard shortcut, appended to the tooltip (e.g. "Ctrl+B"). */
  shortcut?: string;
  icon: IconName;
  onClick: () => void;
}

interface ToolbarProps {
  /** Buttons, split into visually separated groups. */
  groups: ToolbarAction[][];
  /** Disable every button (e.g. while the editor is still initialising). */
  disabled?: boolean;
}

/**
 * A generic icon button bar. Presentation only — it knows nothing about Milkdown;
 * callers wire each action's `onClick` to an editor command.
 *
 * Buttons fire on `onMouseDown` with `preventDefault` so clicking never moves focus
 * out of the editor: the editor keeps its caret/selection and the command applies to
 * it. (A plain `onClick` would blur the editor first, collapsing the selection.)
 */
export function Toolbar({ groups, disabled = false }: ToolbarProps): React.JSX.Element {
  return (
    <div className="body-toolbar" role="toolbar" aria-label="Formatting">
      {groups.map((group, gi) => (
        <div className="body-toolbar__group" key={gi}>
          {group.map((action) => {
            const title = action.shortcut ? `${action.label} (${action.shortcut})` : action.label;
            return (
              <button
                key={action.label}
                type="button"
                className="body-toolbar__btn"
                title={title}
                aria-label={action.label}
                disabled={disabled}
                // Keep editor focus/selection — see component doc.
                onMouseDown={(e) => e.preventDefault()}
                onClick={action.onClick}
              >
                <Icon name={action.icon} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Inline 20×20 SVG icons, stroked with `currentColor`. */
function Icon({ name }: { name: IconName }): React.JSX.Element {
  return (
    <svg
      className="body-toolbar__icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/** SVG geometry per icon. Text-glyph icons (H1/H2/H3, ¶) use a `<text>` node. */
const ICON_PATHS: Record<IconName, React.JSX.Element> = {
  undo: (
    <>
      <path d="M9 7l-5 5 5 5" />
      <path d="M4 12h11a4 4 0 0 1 0 8h-5" />
    </>
  ),
  redo: (
    <>
      <path d="M15 7l5 5-5 5" />
      <path d="M20 12H9a4 4 0 0 0 0 8h5" />
    </>
  ),
  bold: (
    <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z" />
  ),
  italic: (
    <>
      <line x1="19" y1="5" x2="11" y2="5" />
      <line x1="13" y1="19" x2="5" y2="19" />
      <line x1="15" y1="5" x2="9" y2="19" />
    </>
  ),
  strikethrough: (
    <>
      <line x1="4" y1="12" x2="20" y2="12" />
      <path d="M7 7a4 3 0 0 1 8 0M9 17a4 3 0 0 0 8 0" />
    </>
  ),
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  link: (
    <>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  h1: (
    <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" stroke="none" fill="currentColor">
      H1
    </text>
  ),
  h2: (
    <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" stroke="none" fill="currentColor">
      H2
    </text>
  ),
  h3: (
    <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" stroke="none" fill="currentColor">
      H3
    </text>
  ),
  paragraph: (
    <text x="12" y="17" textAnchor="middle" fontSize="16" fontWeight="700" stroke="none" fill="currentColor">
      ¶
    </text>
  ),
  bulletList: (
    <>
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  orderedList: (
    <>
      <line x1="10" y1="6" x2="20" y2="6" />
      <line x1="10" y1="12" x2="20" y2="12" />
      <line x1="10" y1="18" x2="20" y2="18" />
      <text x="3" y="8" fontSize="7" fontWeight="700" stroke="none" fill="currentColor">
        1
      </text>
      <text x="3" y="14" fontSize="7" fontWeight="700" stroke="none" fill="currentColor">
        2
      </text>
      <text x="3" y="20" fontSize="7" fontWeight="700" stroke="none" fill="currentColor">
        3
      </text>
    </>
  ),
  quote: (
    <>
      <line x1="4" y1="5" x2="4" y2="19" />
      <line x1="9" y1="8" x2="20" y2="8" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="16" x2="16" y2="16" />
    </>
  ),
  codeBlock: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 9l-2 3 2 3M15 9l2 3-2 3" />
    </>
  ),
  hr: <line x1="4" y1="12" x2="20" y2="12" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="3" y1="15" x2="21" y2="15" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9" r="1.6" fill="currentColor" stroke="none" />
      <path d="M4 17l5-5 4 4 3-3 4 4" />
    </>
  ),
};
