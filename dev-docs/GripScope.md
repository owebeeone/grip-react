# GripScope

`GripScope` combines the existing keyed matching-context hook with a
`GripProvider` boundary. It provides that context to all descendants.

## Contract

- `scopeKey: string` identifies a UI instance within its enclosing context.
  Use a column or pane identity; put changing values such as city in taps.
- `init?: (context: MatchingContext) => void` synchronously configures a newly
  created context before rendering children. Register initial taps on
  `context.getGripHomeContext()` and optional matcher bindings on `context`.
- `children` consume and mutate values through ordinary GRIP hooks. They do
  not need context props, instance identifiers, or initialization data props.

The enclosing `GripProvider` supplies the engine and parent. An equal key under
the same parent reuses the existing live context, including contexts created by
an external owner. Equal keys under different parents remain independent.
Changing the key or enclosing context selects another scope.

## Initialization and lifetime

Initialization runs when core creates the keyed context, not on every render.
Changing an inline callback or its captured initial values does not reset taps.
Use the scope's mutators for subsequent updates. Keep initialization synchronous
and limited to context configuration; fetch through taps rather than starting
unmanaged external work in the callback.

The component does not retire a context on unmount. A desktop container may
retain its tab context across minimize or unmount and remains responsible for
its lifetime policy. Core's keyed caches use weak references: an unreferenced
context group may be collected and initialized again on later creation. A keyed
matching wrapper stays live while either inner context is still used, preventing
initialization from repeating on an already initialized source. This is not
persistent storage or an eternal once-per-key guarantee.

## Verification

Nine component regressions were established failing before implementation, then
passed: initial reads, independent data and mutators, inline callback changes,
Strict Mode, nested inheritance, parent changes, key changes, external ownership,
missing-provider errors, and initializer failures (some share a test).

The demo has four integration checks for inherited column data and mutators,
provider-control rerenders, independent coin products, and the real mock coin
matcher/stream setup. The weather and coin columns no longer create contexts.

Live browser testing also exposed a core wrapper-lifetime mismatch on tab
re-entry. Two GC regressions failed before its fix; a third verifies that an
entire unused group can still be collected. The fix retains the wrapper through
weak keys on its inner contexts, without permanently retaining unused scopes.

Run the React tests and build from this package:

```sh
pnpm exec vitest run --configLoader runner --no-file-parallelism
pnpm build
```

Run `pnpm test` and `pnpm build` from the sibling demo checkout. Build this
package before installing its file dependency into the demo.
