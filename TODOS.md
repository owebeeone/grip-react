# GRIP React TODOs

This backlog covers React integration and documentation. Core-engine proposals
and the disposition of older entries are recorded in
[the TODO review](dev-docs/TodoReview.md). Verification items below are not
claims of known defects.

## README and examples

- [x] Carry out the [README improvement plan](dev-docs/ReadmePlan.md): lead with
  a concrete React benefit, consolidate the weather example, show isolated
  testing, and verify the runnable setup and snippets.
- [x] Locate the current weather demo and verify the introduction against
  executable source. The small offline example is in the demo's `src/readme/`;
  the full Weather tab retains live service integration.
- [ ] Audit the full live weather demo's refresh interval lifecycle separately.
  The introduction's fixture tests do not verify that timer or live API behavior.
- [ ] Reconcile React-facing lifecycle guidance and links to the core
  specifications with the current API. Remove references to unimplemented
  historical API proposals rather than presenting them as available features.

## Subtree contexts

- [x] Add `GripScope` using the existing keyed matching context and provider.
  Initialize once per new live context, use UI-instance keys, and let descendants
  read values and mutators without explicit context props. Weather and coin
  columns in the demo now use this pattern. See [the contract](dev-docs/GripScope.md).
- Defer an ordinary `useChildContext` initializer until there is a distinct use
  case. The subtree initialization need is covered by `GripScope`.

## React lifecycle verification

- [ ] Extend the existing hook tests for Strict Mode mounting, cleanup, and
  remounting. Check that registration and subscriptions are not duplicated and
  that cleanup leaves other consumers intact.
- [ ] Verify behavior when the provider context or explicit parent changes,
  including subscriptions, tap ownership, keyed initialization, and the
  intentional lifetime-stable behavior of `useLocalContext`.
- [ ] Verify independent consumers and parameter changes through the React
  boundary. Reuse core coverage for resolver rules; add React tests for the
  hook-specific setup, updates, and teardown.

The nine scope tests cover its initialization, Strict Mode, parent/key changes,
inheritance, and external lifetime ownership. The broader hook verification
items above remain open; they are not implied complete by that coverage.

Record a failing regression before changing runtime behavior. Keep new
core-engine defects or design proposals in core's development documentation,
with a concrete reproduction or use case.
