interface HeaderActionsProps {
  /** Narrow viewport → collapse into a ⋯ disclosure; desktop → inline buttons. */
  mobile: boolean;
  canDiscard: boolean;
  isCollection: boolean;
  canAddTranslation: boolean;
  onDiscard: () => void;
  onAddTranslation: () => void;
  onRename: () => void;
  onDelete: () => void;
}

/**
 * The per-page editor-header actions (Discard / Add translation / Rename / Delete).
 *
 * On desktop they render as a plain inline row; on a narrow viewport they collapse behind
 * a **⋯** toggle. This is a deliberate `mobile` branch rather than a CSS-only `<details>`
 * that hides its `<summary>` on desktop: a **closed** `<details>` natively hides its own
 * content, and author CSS can't reliably force it visible — so with the toggle hidden there
 * was no way to reveal the buttons on desktop until the disclosure had been opened while
 * narrow (its `open` state then persisted). Rendering the plain row on desktop avoids the
 * `<details>` entirely, so the actions are always visible where there's room for them.
 */
export function HeaderActions({
  mobile,
  canDiscard,
  isCollection,
  canAddTranslation,
  onDiscard,
  onAddTranslation,
  onRename,
  onDelete,
}: HeaderActionsProps): React.JSX.Element | null {
  if (!canDiscard && !isCollection) return null;

  const buttons = (
    <>
      {canDiscard ? (
        <button
          type="button"
          className="editor-header__discard"
          onClick={onDiscard}
          title="Discard this page's unpublished changes — revert it to the published version."
        >
          Discard changes
        </button>
      ) : null}
      {isCollection ? (
        <>
          {canAddTranslation ? (
            <button
              type="button"
              className="editor-header__translate"
              onClick={onAddTranslation}
              title="Create a draft copy of this page in another language."
            >
              Add translation
            </button>
          ) : null}
          <button type="button" className="editor-header__rename" onClick={onRename}>
            Rename
          </button>
          <button type="button" className="editor-header__delete" onClick={onDelete}>
            Delete
          </button>
        </>
      ) : null}
    </>
  );

  if (!mobile) {
    return <div className="overflow-menu__items">{buttons}</div>;
  }

  return (
    <details className="overflow-menu">
      <summary
        className="overflow-menu__toggle"
        aria-label="More actions"
        title="More actions"
      >
        ⋯
      </summary>
      <div className="overflow-menu__items">{buttons}</div>
    </details>
  );
}
