# GRIP React README improvement plan

Status: Full README rewrite remains planned. GripScope and the scoped weather
and coin demo are implemented; the existing scope example has been updated.

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

1. **What changes for a React component** — a short problem statement and the
   unchanged weather display. Avoid architecture terminology until needed.
2. **The same display in different contexts** — the two locations and their
   composition, with a runnable demo link.
3. **Providers declare their own inputs** — mock-to-live replacement and the
   geocoding chain. Introduce destination parameters through that behavior.
4. **Test each part independently** — a display test supplied with fake data,
   and a producer test supplied with controlled inputs.
5. **Run the example** — installation, complete runtime setup, provider
   registration, mounting, and the command that starts the example.
6. **The concepts behind it** — concise definitions of Grip, Tap, Drip,
   context, and Grok, anchored to code already shown.
7. **Add GRIP to an existing application** — integrate one feature or panel
   at a clear boundary; identify any bridge needed for existing state.
8. **Choose and configure providers** — brief coverage of local, derived,
   asynchronous, and streaming sources, linking to detailed guides.
9. **API reference and further reading** — React hooks, lifecycle guidance,
   core documentation, and optional comparisons.

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

A revised README, a complete runnable example or verified link to one,
focused example checks, and links to the detailed documentation. This plan
tracks that work. The targeted scope example is updated; the broader opening,
provider-chain demonstration, and comparison sections remain to be rewritten.
This work does not publish a release.
