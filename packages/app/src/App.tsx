import { useMemo, useState } from 'react';
import {
  assembleContent,
  loadSchemas,
  canPublish,
  Validator,
  type ContentObject,
} from '@timber/content';
import type { FrontMatter } from '@timber/generator';
import { demoRepo } from './state/demoRepo.js';
import { SchemaForm } from './forms/SchemaForm.js';
import { BodyEditor } from './editor/BodyEditor.js';
import { Preview } from './preview/Preview.js';

interface EditState {
  data: FrontMatter;
  body: string;
}

/**
 * The Phase 4a editor shell: pick an object, edit its front matter through the
 * schema-driven form and its body through Milkdown, and see live preview + live
 * validation. Content is loaded from a bundled demo `RepoSnapshot` (Phase 5 swaps
 * in GitHub); the git autosave/commit/publish loop is deliberately out of scope
 * here — this slice exists to de-risk the editor + byte-stable round-trip.
 */
export function App(): React.JSX.Element {
  // The model is assembled once from the snapshot (same code path as the CLI).
  const { model, validator } = useMemo(() => {
    const schemas = loadSchemas(demoRepo);
    return { model: assembleContent(demoRepo, schemas), validator: new Validator(schemas) };
  }, []);

  const [selectedPath, setSelectedPath] = useState<string>(model.objects[0]?.path ?? '');
  const selected: ContentObject | undefined = model.objects.find((o) => o.path === selectedPath);

  // Editable copy of the selected object, re-seeded when the selection changes.
  const [edit, setEdit] = useState<EditState>(() => ({
    data: { ...(selected?.data ?? {}) },
    body: selected?.body ?? '',
  }));
  const [editingPath, setEditingPath] = useState(selectedPath);
  if (selected && editingPath !== selectedPath) {
    setEditingPath(selectedPath);
    setEdit({ data: { ...selected.data }, body: selected.body });
  }

  const schema = selected ? model.schemas.get(selected.type) : undefined;

  // Live validation of the in-progress edit against the assembled model.
  const validation = useMemo(() => {
    if (!selected || !schema) return undefined;
    const candidate: ContentObject = {
      ...selected,
      data: edit.data,
      body: edit.body,
      public: edit.data.public === true,
    };
    return validator.validateObject(candidate, model);
  }, [selected, schema, edit, validator, model]);

  return (
    <div className="app">
      <aside className="app__sidebar">
        <h1 className="app__brand">Timber</h1>
        <nav>
          <ul className="object-list">
            {model.objects.map((o) => (
              <li key={o.path}>
                <button
                  type="button"
                  className={o.path === selectedPath ? 'is-active' : ''}
                  onClick={() => setSelectedPath(o.path)}
                >
                  <span className="object-list__title">{String(o.data.title ?? o.slug)}</span>
                  <span className="object-list__type">
                    {o.type}
                    {o.public ? '' : ' · draft'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <main className="app__main">
        {selected && schema ? (
          <>
            <header className="editor-header">
              <h2>{String(edit.data.title ?? selected.slug)}</h2>
              <code>{selected.path}</code>
            </header>

            <section className="editor-panel">
              <h3>Fields</h3>
              <SchemaForm
                schema={schema}
                data={edit.data}
                model={model}
                onChange={(key, value) =>
                  setEdit((prev) => {
                    const data = { ...prev.data };
                    if (value === undefined || value === '') delete data[key];
                    else data[key] = value;
                    return { ...prev, data };
                  })
                }
              />
            </section>

            <section className="editor-panel">
              <h3>Body</h3>
              <BodyEditor
                value={edit.body}
                onChange={(body) => setEdit((prev) => ({ ...prev, body }))}
              />
            </section>

            {validation ? (
              <section
                className={`validation ${validation.valid ? 'validation--ok' : 'validation--bad'}`}
              >
                <strong>
                  {validation.valid ? '✓ Valid' : '✗ Invalid'} —{' '}
                  {canPublish(validation) ? 'can be published' : 'draft only'}
                </strong>
                {validation.errors.length > 0 ? (
                  <ul>
                    {validation.errors.map((e, i) => (
                      <li key={i}>
                        {e.field ? <code>{e.field}</code> : null} {e.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </>
        ) : (
          <p>No object selected.</p>
        )}
      </main>

      <aside className="app__preview">
        <h3>Preview</h3>
        {selected ? <Preview data={edit.data} body={edit.body} /> : null}
      </aside>
    </div>
  );
}
