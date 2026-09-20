# Findings

One file per virtual-user run: `<YYYY-MM-DD>-<scenario>.md`, written by the tester in the
shape its agent definition prescribes, then extended by the triager with a `## Triage`
section giving a verdict per finding — _confirmed_ (with the path of the test that
reproduces it), _intended_, _tester error_, or _open_.

Screenshots the tester takes go next to the report and are not committed (`*.png` here is
git-ignored); the report's text should stand without them.

A finding here is a lead, not a verdict. The commit that fixes a confirmed bug should
reference the report.
