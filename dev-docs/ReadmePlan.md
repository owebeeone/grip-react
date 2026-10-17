# GRIP React README improvement plan

Status: README rewrite implemented and locally verified. The introduction uses
an executable, deterministic weather example in the demo's `src/readme/`, with
the full live Weather tab linked separately. Changes are not yet published.

## Purpose and audience

Make the README useful to an experienced React developer who has not used
GRIP. The reader should recognize a problem, see a concrete behavior worth
investigating, and understand how to try it before learning the full API.

The central demonstration is a display component that stays unchanged when
its data provider changes and the replacement provider needs different inputs.
Those inputs are resolved from the consumer's context, including dependencies
provided by other taps. The same mechanism separates producers from producers
as well as UI from producers.

GRIP core remains the framework-independent mechanism reference. GRIP React
explains what that mechanism gives React applications and how to use it.

## Problems in the current README

| Current material | Planned change |
| --- | --- |
| Broad claims about powerful unified state management | Open with a specific application behavior and show it working. |
| Package split and lists of engine internals near the top | Keep a short core relationship note; move implementation details below the introduction. |
| Irrigation metaphor before a working example | Explain typed keys, producers, and contexts directly as they appear in the example. |
| Five-step counter as the first demonstration | Use the weather example to establish the benefit; keep a counter only if it helps the later quick start. |
| Weather contexts, geocoding, and provider switching spread across sections | Present them as one coherent example with a visible before and after. |
| Placeholder output and input declarations in important snippets | Use complete declarations verified against the current implementation. |
| Large comparison section with categorical rankings | Move comparisons later and support specific claims with equivalent examples and current primary documentation. |
| Broken-looking reference markers, missing setup, and inconsistent formatting | Replace markers with working links and make the setup reproducible. |

## The demonstration

Use the existing weather scenario rather than introducing another domain.
Locate and verify the actual demo source before selecting excerpts.

1. Show one small weather display that reads weather values through declared
   grips. It contains no fetching, provider selection, city-to-coordinate
   conversion, or assembly of request parameters.
2. Place that display in two independently configured contexts, for example
   London and Paris. Show where the application supplies each location. The
   display implementation is the same in both places.
3. Begin with a mock weather provider that needs the location name.
4. Switch a context to a live provider that needs latitude and longitude.
   Those inputs resolve through a geocoder that itself needs the location.
5. Show the dependency chain and the small composition declarations that
   establish it. Identify exactly which code changed and which stayed intact.
6. Demonstrate that changing one context's location updates its display
   without redirecting the other context's data.

Keep display code distinct from the code that assembles contexts and supplies
inputs. Context values still have an owner; GRIP resolves them rather than
inventing them. Provider requirements and selection rules must be visible.

Scope keys identify UI instances, such as weather column 1 and column 2, not
the city being displayed. Each column keeps its context while its location
value changes. The implemented [`GripScope`](GripScope.md) component combines keyed context
lookup, an initializer, and the provider boundary; changing location updates
a tap inside that scope rather than creating a context per city.

Keep the introductory UI simple: one `WeatherColumn` contains its display
and its own controls. Do not introduce a separate location-picker component
merely to explain the scope. The column reads its values and mutators through
grips in its current context; each instance can change its own location
without knowing a column ID or affecting another instance. Introduce provider
composition in the next step rather than adding it to the first UI snippet.

Use deterministic local fixtures for the runnable introduction and tests.
An optional real API example can link to the full demo without making a
network service or API account necessary to understand the mechanism.

## Proposed README order

1. **Change the producer. Keep the component.** — a short introduction followed
   immediately by the weather display, before registry and runtime setup.
2. **See the producer requirements and watch the connections change** — compact,
   source-checked declarations directly after the component. Give separate trial
   steps for the fixture page and the full Weather demo with Show Graph/View Code.
3. **Verify the composition** — lead with the transitive geocoder test and the
   switching/independent-column check; keep the isolated display test later.
4. **Start small and try it** — the growth argument, published installation,
   and a complete counter as a quick start after the capability is established.
5. **Complete weather setup** — scopes, contracts, producers, selection rules,
   and mounting. Introduce destination parameters through these declarations.
6. **Test each piece and run the examples** — headless producer and isolated
   display tests, then development-tree commands and the unreleased API caveat.
7. **Concepts and cost** — concise vocabulary and the shared mechanism's benefits.
   Keep the horizon-blindness challenge here, after readers have seen the result.
8. **Add one feature and manage application state** — incremental integration,
   state ownership, and the consumer hook-coordination errors the model avoids.
9. **API reference and further reading** — React hooks, lifecycle guidance,
   core producers, and detailed documentation.

The setup may live in a linked, complete example to keep the first screen
short, but all highlighted excerpts must identify their runnable source.

## Claims and language

Explain the separation in concrete terms: the display knows the output it
needs; each producer declares its own inputs; composition supplies context.
Show how subscriptions and provider connections follow that composition.

Demonstrate testability with a small fixture. Explain correctness by
construction only for error classes actually excluded by the API. Business
rules, valid input data, error presentation, and application intent still need
their own design and tests.

Avoid unexplained acronyms, superlatives, and claims of universal superiority.
Do not present another library's simplest example against a GRIP example with
more capabilities, or omit equivalent capabilities from the alternative.
Separate dependency resolution from caching, request management, and rendering
so readers can see what each part contributes.

## Implementation sequence

1. Inventory the current React exports, demo source, examples, and detailed
   guides. Check which linked APIs and examples are current.
2. Establish the complete weather example and its composition. Verify stable
   context identities, registration, updates, cleanup, and provider switching.
3. Add focused executable checks for the behavior being demonstrated:
   independent contexts, replacement with different required inputs, and
   isolated display and producer tests. Reuse existing coverage where it
   already verifies the same behavior.
4. Draft the README around the verified example. Introduce only the concepts
   needed at each step and link to advanced material.
5. Check all complete snippets with the actual compiler and current packages.
   Remove placeholder implementations and avoid type casts that conceal a
   missing contract. Verify links and installation instructions.
6. Review the opening as a skeptical React reader: can they identify a useful
   capability and explain which code they no longer need to write?

The scope component packages existing context mechanisms; it does not change
core resolution semantics. If the remaining examples expose an implementation
defect, record and address that separately rather than silently changing the
behavior to fit the explanation.

## Completion criteria

- The opening demonstrates a concrete benefit before requiring a vocabulary
  lesson or a comparison table.
- The example shows consumer context selecting inputs for a producer and
  resolving the producer's transitive dependencies.
- The display remains unchanged across the demonstrated contexts and provider
  switch; composition and provider changes are explicit.
- Readers can see how to test the display without fetching or geocoding, and
  test a producer without mounting the application.
- A reader can run the complete example from the documented setup. Excerpts
  and tests agree with the current API and lifecycle behavior.
- Core remains clearly framework-independent; the README concentrates on
  React usage and links to core mechanics and advanced guides.
- The README makes no unsupported performance, cost, migration, or competitor
  claims.

## Deliverables

A revised README, a complete runnable example, focused example checks, and links
to detailed documentation are implemented. This work does not publish a release.

## Local verification and resulting shape

- The opening identifies GRIP React, retains typed contracts and dynamic
  connections, and reaches the weather component before setup. The producer
  declarations, producer switch, graph/source controls, and composition tests
  establish the payoff before the growth and cost arguments. Display isolation
  remains documented with the detailed tests.
- The complete introduction is in `grip-react-demo/src/readme/`. A minimal
  counter at `/readme-counter.html` follows the weather demonstration in the
  README as a complete quick start; weather runs at `/readme-weather.html`.
  Both introductions and the main demo are included in the build. The counter
  entry includes imports, registry, grips, producer registration, provider, and
  mounting; a browser check confirms clicking updates the displayed count.
- Mock weather requires a city; its async replacement requires coordinates.
  A separate geocoder declares the city requirement. Deterministic local
  fixtures replace network calls in the introduction; the full Weather demo
  remains the linked live-service example. One coordinates grip keeps the
  introductory chain smaller than the full latitude/longitude implementation.
- Four executable example tests cover isolated UI updates, independent columns
  across provider changes without remounting, an async producer tested without
  React, and demand-driven transitive geocoder resolution.
- Fifteen README code excerpts are checked against those source files and tests,
  including three compact input/output declarations, both composition tests,
  the counter, application shell, and entry point.
  `node scripts/check-readme.mjs` in the demo verifies exact agreement. The
  example also passes the demo's strict TypeScript and focused lint checks.
- The categorical library-comparison tables and placeholder code are removed.
  The React API summary, buffered editing behavior, scope lifetime, and source
  setup describe the current implementation. Broader hook lifecycle checks in
  `TODOS.md` are still separate work.
- Full local check: 17 demo tests pass, all three HTML entries build, and all fifteen
  excerpts match. New remote source links will be available after publication
  of these changes; they currently resolve to files in the local checkouts.
- Follow-up documentation review separates published package installation from
  development-tree setup, defines Tap before registration, explains the generic
  order (outputs, home parameters, destination parameters), and documents
  `<output>`'s implicit status role. Removing the explicit FunctionTap generics
  was checked with TypeScript and produces four diagnostics, so this edit does
  not pretend inference is supported or change the core API. The four example
  tests and strict type check pass again after these documentation edits.
