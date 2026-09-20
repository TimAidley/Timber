# Virtual-user testing

Bugs that get past the unit suites are mostly _flow_ bugs — state carried between
components across a real session: an edit that autosaved but didn't publish, a badge that
disagrees with the branch, a layout mode that breaks after a reload. The cheapest way to
find those is to have someone **use** the editor. This folder is the tooling for having an
agent do it.

```
pnpm virtual-user          # real editor + fake GitHub on localhost, seeded from site-template/
/virtual-user              # in Claude Code: run a scenario with the blind tester agent
```

How it fits together:

| Piece         | Where                                   | Role                                                                                                                           |
| ------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Fake GitHub   | `packages/fake-github`                  | In-memory git + Actions behind the REST subset the editor uses. No network, resettable, can stage failures.                    |
| Launcher      | `packages/app/test/e2e/virtual-user.ts` | Serves the editor pointed at the fake (via `apiBaseUrl`), plus a `/__control` API for staging events and reading ground truth. |
| Tester agent  | `.claude/agents/virtual-user.md`        | Blind by construction: Playwright MCP tools + `Write` only. Plays a persona, reports expected-vs-actual.                       |
| Orchestration | `.claude/skills/virtual-user/SKILL.md`  | The sighted side: brief the tester, check its report against `/__control/state` and the code, turn bugs into tests.            |
| Scenarios     | `scenarios/*.md`                        | Persona + goal, written as intentions rather than click paths.                                                                 |
| Findings      | `findings/*.md`                         | One report per run, with a triage section appended.                                                                            |

You can use the environment yourself too: start it, open the editor URL, paste the token
it prints. Everything you do lands in the in-memory repo; `GET /__control/state` shows it.

## Why blind, and why it isn't enough on its own

Telling a model "don't read the source" does not make it a user: the repo's own
instructions describe the content model and workflow, and the model's fluency with
software makes it recover from confusion faster than a real site owner would. So the
tester is restricted _structurally_ (no file, shell or repo tools) and the persona is
written to be naïve. Even so, it is good at **logic** bugs — lost data, wrong state,
controls that misbehave — and weaker at spotting what would _confuse_ a person. That is the
trade this project wants right now.

Every confirmed bug becomes a deterministic test (`packages/app/test/e2e/*.e2e.ts` on the
same harness, or a unit test) before it is fixed. The virtual user finds bugs; it is not
the regression suite.
