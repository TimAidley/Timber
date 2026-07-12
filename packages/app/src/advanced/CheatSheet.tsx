import { FIELD_REFERENCE, SCHEMA_KEYS, SCHEMA_EXAMPLE } from './schemaReference.js';

/**
 * A collapsible schema **cheat sheet** (SPEC §8) rendered under the advanced editor
 * when a `config/schemas/*` file is open. It documents the top-level keys and every
 * field `type` (with its extra options) so authors don't have to remember the YAML
 * vocabulary — the field rows are generated from {@link FIELD_REFERENCE}, kept in sync
 * with the content package by a test. Defaults to closed so it never crowds the editor.
 */
export function CheatSheet(): React.JSX.Element {
  return (
    <details className="cheat-sheet">
      <summary>YAML cheat sheet</summary>

      <div className="cheat-sheet__body">
        <h4>Top-level keys</h4>
        <table className="cheat-sheet__table">
          <tbody>
            {SCHEMA_KEYS.map((k) => (
              <tr key={k.key}>
                <th scope="row">
                  <code>{k.key}</code>
                </th>
                <td>{k.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4>Field types</h4>
        <table className="cheat-sheet__table">
          <thead>
            <tr>
              <th scope="col">type</th>
              <th scope="col">what it is</th>
              <th scope="col">options</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_REFERENCE.map((f) => (
              <tr key={f.kind}>
                <th scope="row">
                  <code>{f.kind}</code>
                </th>
                <td>{f.summary}</td>
                <td className="cheat-sheet__opts">
                  {f.options.map((o) => (
                    <code key={o}>{o}</code>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h4>Example</h4>
        <pre className="cheat-sheet__example">
          <code>{SCHEMA_EXAMPLE}</code>
        </pre>
      </div>
    </details>
  );
}
