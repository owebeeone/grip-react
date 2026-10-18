# GRIP React

**Make your components testable and retargetable—without the wiring clutter.**

GRIP React is the React integration for GRIP, a reactive dataflow system.
Components declare the values and actions they need while remaining
supplier-agnostic.

GRIP's declarative context model provides a typed API and builds connections
dynamically, keeping consumers connected to the right producers as things
change. TypeScript knows the values and actions each component consumes.

[See the producer switch](#watch-the-connections-change) ·
[Building with an LLM](#building-with-an-llm) ·
[Install](#install-the-published-package) ·
[Run the examples](#run-the-development-examples) · [React API](#react-api)

## Change the producer. Keep the component.

This weather column edits a location and displays a temperature.
It stays the same when the source of that temperature changes.

A **grip** is a typed key, such as `TEMPERATURE`. `useGrip` reads its current
value and subscribes to changes. `useSelectGrip` binds a select to a value and
its mutator, both supplied by the enclosing context.

<!-- demo-source: src/readme/WeatherColumn.tsx -->
```tsx
import { useGrip, useSelectGrip } from '@owebeeone/grip-react';
import { LOCATION, LOCATION_TAP, TEMPERATURE } from './grips';

export default function WeatherColumn() {
  // GRIP supplies this column's values and mutator from its surrounding scope.
  const location = useSelectGrip(LOCATION, LOCATION_TAP);
  const temperature = useGrip(TEMPERATURE);

  return (
    <section>
      <label>
        Location
        <select {...location}>
          <option>Sydney</option>
          <option>Paris</option>
        </select>
      </label>
      <output>{temperature == null ? 'Loading' : `${temperature} °C`}</output>
    </section>
  );
}
```

This component knows the contracts for location and temperature. It does not
import a weather producer, accept a column identifier, fetch data, or pass a city
to a weather service. It still owns presentation: the control, units, and loading
text belong here.

### The producers declare what changes

These are the input/output entries from the three
[tap configurations](#producers-declare-their-own-inputs) in the runnable example.
The computation and request handling are shown in full below.

**Mock weather** provides temperature and needs the column's location:

<!-- demo-declaration: src/readme/providers.ts#createMockWeatherTap -->
```ts
provides: [TEMPERATURE],
destinationParamGrips: [LOCATION],
```

**Coordinate weather** provides the same temperature and needs coordinates:

<!-- demo-declaration: src/readme/providers.ts#createCoordinateWeatherTap -->
```ts
provides: TEMPERATURE,
destinationParamGrips: [COORDINATES],
```

**The geocoder** provides those coordinates and needs the column's location:

<!-- demo-declaration: src/readme/providers.ts#createGeocoderTap -->
```ts
provides: [COORDINATES],
destinationParamGrips: [LOCATION],
```

The weather producers share an output contract, while their input requirements
differ. GRIP resolves those requirements from each column's context. The column
above reads the same grips throughout.

### Dynamic linking for application dataflow

If you know dynamic linking with ELF shared libraries, GRIP uses a familiar
principle: declare what is required and let a runtime resolve the implementation.
The [dynamic linker](https://man7.org/linux/man-pages/man8/ld.so.8.html) resolves
imported symbols to implementations; GRIP resolves typed data and action
requirements to producers using the requesting context. Think of it as
**dynamic linking for application dataflow in React**.

GRIP applies that principle to reactive connections, including each producer's
own input requirements. In this example, the replacement weather producer needs
coordinates, which the geocoder supplies from the column's location. GRIP
resolves the chain and maintains the connections as contexts and producers
change. The display keeps the same contracts throughout.

## Watch the connections change

Put this same component in two scopes, each with its own location. Change one
column's location and the other keeps its own value.

The source selector chooses between the two weather producers. When the selected
producer needs coordinates, GRIP resolves them through the geocoder using the
requesting column's location:

```text
Column's location → Geocoder → Coordinates → Weather producer → Column's temperature
```

**The component never assembles that sequence or passes parameters to either
producer.** Each producer declares its own inputs and outputs; GRIP builds and
maintains the connections. Producers can be componentized like consumers.

[Run the examples](#run-the-development-examples), then try either route:

- **Repeatable local trial:** open `/readme-weather.html`. Change one column's
  city and check that the other keeps its own city. Switch **Mock** to
  **Coordinates (fixture)**, then back. Both temperatures update through the
  selected producer; the cities and controls stay in place. This version uses
  local fixtures and makes no external requests.
- **Live graph:** open the main demo's **Weather** tab and choose **Show Graph**.
  Change a location and switch **Mock** / **Meteo**. Follow the green data
  connections from the selected weather producer; Meteo requires coordinates
  from the geocoder. **View Code** shows the actual UI and producer source.

In both versions, the display imports neither weather implementation nor the
geocoder. The [composition tests](#verify-the-composition) check that changing
producers keeps the existing column controls mounted.

## Verify the composition

Requesting temperature is enough to activate the geocoder dependency. This test
registers the producers and observes the output; it never calls the geocoder
itself. The lookup is unused until temperature is requested:

<!-- demo-test: tests/readmeWeather.test.tsx#transitive -->
```tsx
it('resolves the geocoder as a transitive input of the weather producer', async () => {
  const grok = new Grok(registry);
  grok.registerTap(createAtomValueTap(LOCATION, { initial: 'Paris' }));
  const lookup = vi.fn(() => ({ latitude: 48.86, longitude: 2.35 }));
  grok.registerTap(createGeocoderTap(lookup));
  const weather = createCoordinateWeatherTap();
  grok.registerTap(weather);
  expect(lookup).not.toHaveBeenCalled();
  const result = grok.query(TEMPERATURE, grok.mainContext);
  const unsubscribe = result.subscribe(() => {});
  try {
    grok.flush();
    await waitFor(() => expect(result.get()).toBe(14));
    expect(lookup).toHaveBeenCalledWith('Paris');
  } finally {
    unsubscribe();
    grok.unregisterTap(weather);
  }
});
```

The next check edits one column independently, switches weather producers in
both directions, and verifies that the original column control is still mounted.

<details>
<summary>See the producer-switching and independent-column test</summary>

<!-- demo-test: tests/readmeWeather.test.tsx#composition -->
```tsx
it('keeps both columns and their selected cities through provider changes', async () => {
  const grok = createWeatherRuntime();
  const view = render(<App grok={grok} />);
  const left = within(view.getByRole('region', { name: 'Column 1' }));
  const right = within(view.getByRole('region', { name: 'Column 2' }));
  await waitFor(() => expect(left.getByRole('status').textContent).toBe('20 °C'));
  expect(right.getByRole('status').textContent).toBe('12 °C');
  const column = left.getByRole('combobox');
  act(() => { fireEvent.change(column, { target: { value: 'Paris' } }); grok.flush(); });
  expect(left.getByRole('status').textContent).toBe('12 °C');
  act(() => { fireEvent.change(view.getByRole('combobox', { name: 'Weather provider' }), { target: { value: 'coordinates' } }); grok.flush(); });
  await waitFor(() => expect(left.getByRole('status').textContent).toBe('14 °C'));
  expect(right.getByRole('status').textContent).toBe('14 °C');
  expect(left.getByRole('combobox')).toBe(column);
  act(() => { fireEvent.change(column, { target: { value: 'Sydney' } }); grok.flush(); });
  await waitFor(() => expect(left.getByRole('status').textContent).toBe('22 °C'));
  expect(right.getByRole('status').textContent).toBe('14 °C');
  act(() => { fireEvent.change(view.getByRole('combobox', { name: 'Weather provider' }), { target: { value: 'mock' } }); grok.flush(); });
  await waitFor(() => expect(left.getByRole('status').textContent).toBe('20 °C'));
  expect(right.getByRole('status').textContent).toBe('12 °C');
});
```

</details>

Both checks are in the
[executable introduction tests](https://github.com/owebeeone/grip-react-demo/blob/main/tests/readmeWeather.test.tsx).
Each piece can also be tested in isolation: supply the
[display's values](#test-the-component-with-supplied-values), or test a
[producer without React](#test-the-producer-without-react).

## Start small. Keep the same model as you grow.

A small application still benefits from testable, supplier-agnostic components.
GRIP provides typed contracts, independent producers, and connection management
from the first feature. As requirements grow, add scopes, derived values, or
asynchronous sources using the same model. The building blocks are already
available; you don't have to invent new plumbing for each stage.

### Try GRIP in one feature

Keep the application, state management, and services you already have. Wrap a
panel in `GripProvider` and use a small
[adapter](#add-one-feature-to-an-existing-application) to expose existing values
and actions through typed grips. The existing system can remain the source of
truth while the panel becomes independently testable and supplier-agnostic.
Adoption can grow one feature at a time.

Choose a feature you expect to change. Test its display with supplied values,
inspect its data connections, then introduce a different source or an additional
producer dependency. See which parts stay untouched and how much coordination
GRIP handles for you. That gives you a practical basis for deciding where to use
it next, with a working feature as the result of the trial.

## Building with an LLM

Give the coding agent the complete examples and these implementation rules:

- **Put state and coordination in taps.** Consumers read typed values and
  actions through `useGrip` and the GRIP binding helpers. Keep derived values,
  fetching, and subscriptions in producers, instead of rebuilding that machinery
  with React state and effect hooks in each display.
- **Declare producer dependencies.** Use destination parameters for inputs
  selected by the consumer's context. Each producer declares its own needs;
  the UI does not assemble the dependency sequence or import concrete producers.
- **Compose stable UI scopes.** Scope keys identify columns or panes, not
  changing data such as cities. Initialize a new context once, then change its
  values through supplied mutators. Create the runtime outside rendering.
- **Keep one owner for existing state.** During incremental adoption, an adapter
  exposes the existing system's values and actions. Mutations call that system;
  its updates flow back through the adapter. The adapter owns its external
  subscription and cleanup. Producers own resources such as timers and requests.
- **Use the actual API and executable examples.** The compact declarations
  above are excerpts; the full configurations and setup are below.

Verify [the dependency chain and producer switch](#verify-the-composition),
[display isolation](#test-the-component-with-supplied-values), and
[producer isolation](#test-the-producer-without-react). Automated hook-import
checks can [enforce the application architecture](#application-state-through-usegrip)
for generated code as well as human-written changes.

## Install the published package

In an existing React application, install the released library normally:

```sh
npm install @owebeeone/grip-react
```

Or, with pnpm:

```sh
pnpm add @owebeeone/grip-react
```

React and React DOM are peer dependencies (React 18 or later); core is installed
as a package dependency. Consumers of a released version do not need sibling
source repositories.

See the [release notes](dev-docs/ReleaseNotes.md) for API additions by release.

## Quick start: one value, one component

Here is a complete React entry point for a page containing `<div id="root"></div>`:

<!-- demo-source: src/readme/counter.tsx -->
```tsx
import { createRoot } from 'react-dom/client';
import {
  GripOf, GripRegistry, Grok, GripProvider, useGrip,
  createAtomValueTap, type AtomTapHandle,
} from '@owebeeone/grip-react';

const registry = new GripRegistry();
const defineGrip = GripOf(registry);
const COUNT = defineGrip<number>('Count');
const COUNT_TAP = defineGrip<AtomTapHandle<number>>('Count.Handle');

const grok = new Grok(registry);
grok.registerTap(createAtomValueTap(COUNT, { initial: 0, handleGrip: COUNT_TAP }));

export function Counter() {
  const count = useGrip(COUNT);
  const counter = useGrip(COUNT_TAP);
  return <button onClick={() => counter?.update(n => n + 1)}>Count: {count}</button>;
}

createRoot(document.getElementById('root')!).render(
  <GripProvider grok={grok}><Counter /></GripProvider>,
);
```

The component reads its value and mutator through `useGrip`. The atom stores the
value, and GRIP delivers updates; no component-local state or effects are needed.
Run it at `/readme-counter.html` using the development setup below, or use the
entry point in an existing React application. The demo's
[HTML entry](https://github.com/owebeeone/grip-react-demo/blob/main/readme-counter.html)
shows the root element and script tag.

## Two instances, independent values and controls

`GripScope` gives a subtree its own context. The application initializes each
column's location; the column reads and changes it through the same grips.
A **Tap** is a data producer: the `createAtomValueTap` calls below create location
state and expose its mutator. `registerTap` makes that producer available in the
scope's home context.

<!-- demo-source: src/readme/WeatherColumns.tsx -->
```tsx
import { GripScope, createAtomValueTap } from '@owebeeone/grip-react';
import { LOCATION, LOCATION_TAP } from './grips';
import WeatherColumn from './WeatherColumn';

export default function WeatherColumns() {
  return (
    <div className="weather-columns">
      <section aria-label="Column 1">
        <GripScope scopeKey="weather-column:1" init={ctx =>
          ctx.getGripHomeContext().registerTap(createAtomValueTap(LOCATION, {
            initial: 'Sydney', handleGrip: LOCATION_TAP,
          }))
        }>
          <WeatherColumn />
        </GripScope>
      </section>
      <section aria-label="Column 2">
        <GripScope scopeKey="weather-column:2" init={ctx =>
          ctx.getGripHomeContext().registerTap(createAtomValueTap(LOCATION, {
            initial: 'Paris', handleGrip: LOCATION_TAP,
          }))
        }>
          <WeatherColumn />
        </GripScope>
      </section>
    </div>
  );
}
```

Both columns render `WeatherColumn` unchanged. Selecting Paris in the first
column changes its location atom; it does not change the other column.

The keys identify **UI instances**, not cities. A column keeps its scope when
Sydney changes to Paris. The initializer runs when that live keyed context is
created, before its children read it; a rerender or a new inline callback does
not reset its values. Later changes go through the mutator.

Here are the complete contract definitions, including `LOCATION_TAP`, the typed
key for the location's controller:

<!-- demo-source: src/readme/grips.ts -->
```ts
import { GripOf, GripRegistry, type AtomTapHandle } from '@owebeeone/grip-react';

export const registry = new GripRegistry();
const defineGrip = GripOf(registry);

export type City = 'Sydney' | 'Paris';
export type Coordinates = { latitude: number; longitude: number };
export type WeatherSource = 'mock' | 'coordinates';

export const LOCATION = defineGrip<City>('Readme.Location');
export const LOCATION_TAP = defineGrip<AtomTapHandle<City>>('Readme.Location.Handle');
export const TEMPERATURE = defineGrip<number>('Readme.Temperature');
export const COORDINATES = defineGrip<Coordinates>('Readme.Coordinates');
export const SOURCE = defineGrip<WeatherSource>('Readme.Source', 'mock');
export const SOURCE_TAP = defineGrip<AtomTapHandle<WeatherSource>>('Readme.Source.Handle');
```

## Producers declare their own inputs

The first weather producer needs a city name. Its replacement needs coordinates.
A separate geocoder provides coordinates from a city name.

The important declarations are `provides` and `destinationParamGrips`. A
**destination parameter** is read from the context consuming that producer's
output. It is not a parameter the UI has to assemble and pass to the producer.

| Producer | Provides | Requires from the consuming context |
| --- | --- | --- |
| Mock weather | `TEMPERATURE` | `LOCATION` |
| Coordinate weather | `TEMPERATURE` | `COORDINATES` |
| Geocoder | `COORDINATES` | `LOCATION` |

The dependency chain introduced above follows from these declarations.
Neither the column nor the weather producer imports or calls the geocoder.

Here are the complete producers used by the runnable introduction. Their data is
**a deterministic fixture, not a live forecast**. This keeps the dependency
mechanism visible without HTTP response parsing or a network requirement.

`createFunctionTap` uses the type slots `<Outputs, HomeParams, DestinationParams>`
here. `Record<string, never>` means there are no home parameters. These records
are explicit because the current API does not infer them from the grip arrays.

<!-- demo-source: src/readme/providers.ts -->
```ts
import { createAsyncValueTap, createFunctionTap } from '@owebeeone/grip-react';
import { COORDINATES, LOCATION, TEMPERATURE, type City, type Coordinates } from './grips';

// Small, deterministic fixtures keep the introduction independent of a service.
const coordinates: Record<City, Coordinates> = {
  Sydney: { latitude: -33.87, longitude: 151.21 },
  Paris: { latitude: 48.86, longitude: 2.35 },
};

export function createMockWeatherTap() {
  // Type slots: outputs, home parameters (none), destination parameters.
  return createFunctionTap<
    { temperature: typeof TEMPERATURE }, Record<string, never>, { location: typeof LOCATION }
  >({
    provides: [TEMPERATURE],
    destinationParamGrips: [LOCATION],
    compute: ({ getDestParam }) => {
      const city = getDestParam(LOCATION);
      return new Map([[TEMPERATURE, city === 'Sydney' ? 20 : 12]]);
    },
  });
}

export function createGeocoderTap(lookup = (city: City) => coordinates[city]) {
  return createFunctionTap<
    { coordinates: typeof COORDINATES }, Record<string, never>, { location: typeof LOCATION }
  >({
    provides: [COORDINATES],
    destinationParamGrips: [LOCATION],
    compute: ({ getDestParam }) => {
      const city = getDestParam(LOCATION);
      return city ? new Map([[COORDINATES, lookup(city)]]) : new Map();
    },
  });
}

export function createCoordinateWeatherTap(
  fetchTemperature: (point: Coordinates, signal: AbortSignal) => Promise<number> =
    async point => point.latitude < 0 ? 22 : 14,
) {
  return createAsyncValueTap({
    provides: TEMPERATURE,
    destinationParamGrips: [COORDINATES],
    requestKeyOf: params => {
      const point = params.get(COORDINATES);
      return point ? `${point.latitude}:${point.longitude}` : undefined;
    },
    fetcher: (params, signal) => {
      const point = params.get(COORDINATES);
      if (!point) throw new Error('Weather requires coordinates');
      return fetchTemperature(point, signal);
    },
  });
}
```

The async producer receives an abort signal and supplies a request key derived
from coordinates. Request handling belongs in the tap; React still reads
`TEMPERATURE` in the same way. In an application, give `fetchTemperature` your
service implementation and handle loading and errors through suitable contracts.

The [full Weather demo](https://github.com/owebeeone/grip-react-demo) uses
[Open-Meteo producers](https://github.com/owebeeone/grip-react-demo/blob/main/src/openmeteo_taps.ts)
with separate latitude and longitude outputs. The small introduction uses one
coordinates value to keep the same composition principle easy to read.

### Switch the producer, keep the columns

The application defines selection rules once. These bindings select the weather
tap from the `SOURCE` value; the geocoder is registered separately and supplies
coordinates when they are requested.

<!-- demo-source: src/readme/runtime.ts -->
```ts
import { Grok, createAtomValueTap, withOneOf } from '@owebeeone/grip-react';
import { registry, SOURCE, SOURCE_TAP } from './grips';
import { createCoordinateWeatherTap, createGeocoderTap, createMockWeatherTap } from './providers';

export function createWeatherRuntime() {
  const grok = new Grok(registry);
  grok.registerTap(createAtomValueTap(SOURCE, { initial: 'mock', handleGrip: SOURCE_TAP }));
  grok.registerTap(createGeocoderTap());
  grok.addBinding({
    id: 'mock-weather',
    query: withOneOf(SOURCE, 'mock', 10).build(),
    tap: createMockWeatherTap(),
    baseScore: 5,
  });
  grok.addBinding({
    id: 'coordinate-weather',
    query: withOneOf(SOURCE, 'coordinates', 10).build(),
    tap: createCoordinateWeatherTap(),
    baseScore: 5,
  });
  return grok;
}
```

The application shell brings the runtime, source selector, and columns together.
The selector is inside `GripProvider`, so its hook reads the supplied runtime:

<!-- demo-source: src/readme/App.tsx -->
```tsx
import { GripProvider, useSelectGrip, type Grok } from '@owebeeone/grip-react';
import { SOURCE, SOURCE_TAP } from './grips';
import WeatherColumns from './WeatherColumns';

function SourcePicker() {
  const source = useSelectGrip(SOURCE, SOURCE_TAP);
  return (
    <label>
      Weather provider
      <select {...source}>
        <option value="mock">Mock</option>
        <option value="coordinates">Coordinates (fixture)</option>
      </select>
    </label>
  );
}

export default function App({ grok }: { grok: Grok }) {
  return (
    <GripProvider grok={grok}>
      <h1>One weather column, two contexts</h1>
      <SourcePicker />
      <WeatherColumns />
    </GripProvider>
  );
}
```

Finally, create the runtime once and mount the app:

<!-- demo-source: src/readme/main.tsx -->
```tsx
import { createRoot } from 'react-dom/client';
import App from './App';
import { createWeatherRuntime } from './runtime';
import './weather.css';

const grok = createWeatherRuntime();
createRoot(document.getElementById('root')!).render(<App grok={grok} />);
```

Changing the source selector selects the other producer. Existing location
values, controls, and column implementations stay intact.

The pieces have distinct responsibilities:

- The column renders values and invokes its supplied mutator.
- Each producer declares the inputs it needs and computes or retrieves outputs.
- Composition supplies initial values and provider-selection rules.
- GRIP resolves those declarations, maintains subscriptions, and delivers updates.

## Test the producer without React

The producer can be tested without mounting React. Supply coordinates, inject a
controlled service, and query its output:

<!-- demo-test: tests/readmeWeather.test.tsx#producer -->
```tsx
it('tests the weather producer without React or a geocoder', async () => {
  const grok = new Grok(registry);
  const point = { latitude: -33.87, longitude: 151.21 };
  grok.registerTap(createAtomValueTap(COORDINATES, { initial: point }));
  const fetchTemperature = vi.fn(async () => 23);
  const weather = createCoordinateWeatherTap(fetchTemperature);
  grok.registerTap(weather);
  const result = grok.query(TEMPERATURE, grok.mainContext);
  const unsubscribe = result.subscribe(() => {});
  try {
    grok.flush();
    await waitFor(() => expect(result.get()).toBe(23));
    expect(fetchTemperature).toHaveBeenCalledWith(point, expect.any(AbortSignal));
  } finally {
    unsubscribe();
    grok.unregisterTap(weather);
  }
});
```

These excerpts come from the
[executable introduction tests](https://github.com/owebeeone/grip-react-demo/blob/main/tests/readmeWeather.test.tsx),
which include the imports, cleanup, and assertions. They also verify independent
column edits, switching in both directions without remounting, and the geocoder
being resolved through the weather producer's requirement.

This is a repeatable test boundary: supply the declared inputs instead of
assembling the rest of the application. Business rules and provider-selection
policies still need tests of their own.

## Test the component with supplied values

The display can be tested without any weather or geocoding implementation.
Supply its contracts with atoms, render it, and change a value:

<!-- demo-test: tests/readmeWeather.test.tsx#display -->
```tsx
it('tests the display with supplied data, without weather or geocoding producers', () => {
  const grok = new Grok(registry);
  grok.registerTap(createAtomValueTap(LOCATION, { initial: 'Sydney', handleGrip: LOCATION_TAP }));
  const temperature = createAtomValueTap(TEMPERATURE, { initial: 25 });
  grok.registerTap(temperature);
  const view = render(<GripProvider grok={grok}><WeatherColumn /></GripProvider>);
  // <output> has the implicit ARIA role "status".
  expect(view.getByRole('status').textContent).toBe('25 °C');
  act(() => { temperature.set(26); grok.flush(); });
  expect(view.getByRole('status').textContent).toBe('26 °C');
});
```

The same component runs against supplied values here and either weather source
in the application. The
[executable tests](https://github.com/owebeeone/grip-react-demo/blob/main/tests/readmeWeather.test.tsx)
also check independent column edits, producer switching without remounting, and
the geocoder being resolved when temperature is requested.

Producers have the same isolation boundary: supply their inputs and test them
without mounting React. A [complete producer test](#test-the-producer-without-react)
is included below.

## Run the development examples

The development demo uses sibling source packages. From a new directory, clone
and build them in dependency order. Use Node.js 24 and pnpm, as used for local
verification:

```sh
git clone https://github.com/owebeeone/grip-core.git
git clone https://github.com/owebeeone/grip-react.git
git clone https://github.com/owebeeone/grip-react-demo.git

cd grip-core
pnpm install
pnpm build
cd ../grip-react
pnpm install
pnpm build
cd ../grip-react-demo
pnpm install
pnpm dev
```

Open **`/readme-weather.html`** for the weather introduction or
**`/readme-counter.html`** for the minimal counter, on the address Vite prints. Change either
location, then switch from **Mock** to **Coordinates (fixture)**. There are no
external requests in this introduction. The
[entry point](https://github.com/owebeeone/grip-react-demo/blob/main/src/readme/main.tsx)
creates the runtime once and mounts the app; the
[HTML entry](https://github.com/owebeeone/grip-react-demo/blob/main/readme-weather.html)
provides the root element.

The main demo at `/` also includes live weather, coin streams, a calculator,
and editable text with derived values. **View Code** shows the actual source for
the active tab. **Show Graph** keeps the demo visible beside the live graph:
grey lines show child-to-parent context links; green lines show resolved
provider-to-consumer data connections.

From the demo checkout:

```sh
pnpm test
pnpm build
node scripts/check-readme.mjs
```

The last command checks that this README's example excerpts match the tested
source files in the sibling demo checkout. Rebuild a library before reinstalling
its local file dependency into the demo when changing library code.

For an existing React application, `GripProvider` is the entry boundary. Define
your grips, create one runtime outside component rendering, register providers,
and wrap the feature that consumes them. The source example above includes all
of those pieces. GRIP React re-exports core APIs; importing its React integration
does not require a separate core import in application code.

## The concepts behind the example

| Name | Role |
| --- | --- |
| **Grip** | A typed identifier for a value or capability; it is not a state container. |
| **Tap** | A producer that provides one or more grips and declares its input requirements. |
| **Drip** | The live, subscribable result of a grip request. React hooks manage the subscription. |
| **Context** | The surroundings used to resolve a request and its parameters. Contexts form a graph and can inherit providers. |
| **Grok** | The runtime that manages the graph and resolves connections. |
| **Destination parameter** | An input resolved from the consumer's context, so one producer can serve differently configured consumers. |
| **Home parameter** | An input resolved from the producer's home context, shared according to that placement. |

`@owebeeone/grip-core` implements the framework-independent mechanism. This
package adds React providers, scopes, hooks, input bindings, and graph tools.
React renders the interface; GRIP maintains the data connections.

## A small mechanism that replaces application plumbing

GRIP adds a focused dataflow mechanism; React remains the rendering engine.
The core's [graph](https://github.com/owebeeone/grip-core/blob/main/src/core/graph.ts),
[resolver](https://github.com/owebeeone/grip-core/blob/main/src/core/tap_resolver.ts),
and [engine orchestration](https://github.com/owebeeone/grip-core/blob/main/src/core/grok.ts)
total about **2,400 source lines**, including comments and blank lines. The
resolver itself is under 800 lines. These counts describe those three pieces,
not the full package: tap implementations, matching, and React integration add
their own supporting code.

The development cost is the work GRIP replaces. You reuse connection management,
parameter resolution, and reactive updates instead of implementing them in each
feature. Where those relationships would otherwise need custom imperative
coordination, adopting GRIP can mean less code and less development work—not
another system to build alongside the application.

## Why the combination matters

GRIP combines established principles—separation of concerns, typed contracts,
and reactive dependency resolution—so their benefits reinforce each other.
The same boundary that makes a component supplier-agnostic also makes it easier
to test, instrument, inspect, and compose with independent producers.

Those boundaries also provide a foundation for application features such as
undo and redo around state changes. Graph inspection shows the active producers,
consumers, and connections, making the dataflow visible while the application runs.

These capabilities share one mechanism. Application code declares requirements
and behavior; it doesn't have to rebuild the connection machinery for each
feature. In the weather example, independent instances, provider switching, and
an additional dependency chain all work without changing the consuming column.

That is the development-cost argument: additional capability can require less
application code, not more. Reusing the machinery removes wiring that would
otherwise have to be written, tested, debugged, and maintained as the application
evolves. The return comes from work that no longer needs doing.

**Beware horizon blindness: unfamiliar abstractions are easy to count; familiar
plumbing is easy to overlook.**

GRIP is a practical alternative for ordinary React applications. It provides
supplier-independent components, independently testable producers, and inspectable
data flow through one consistent mechanism. A fair comparison counts both the
concepts introduced and the connection, synchronization, and lifecycle code
eliminated. Unfamiliarity alone doesn't establish greater complexity or
development cost; that conclusion needs a concrete account of the extra work.

## Add one feature to an existing application

Start with a panel or operation that has a clear input/output contract. Provide
its initial inputs at a `GripProvider` or `GripScope` boundary, then let the
feature read grips and invoke supplied capabilities.

Existing state and services can remain where they are. An adapter tap can read
an existing service and publish the corresponding grips. That adapter owns the
subscription and cleanup; consumers do not need to know the service's API.
An application does not need to migrate all its state at once.

## Application state through useGrip

GRIP can own all application and UI state: local values, derived data,
asynchronous requests, and streams. Consumer components can obtain values and
actions through `useGrip` alone, without directly using React's own hooks.
Event handlers invoke the supplied actions; producers own the state changes,
computation, and external work.

Removing that hook coordination from consumers eliminates a whole class of
potential bugs in those components:

- Missing dependencies that leave effect callbacks or memoized results using
  outdated inputs.
- Unstable effect dependencies that repeatedly restart work or trigger update
  loops.
- Derived values copied into local state that fall out of sync, with chains of
  effects producing stale intermediate renders.
- Subscription setup and cleanup that each consuming component must implement
  and can get wrong.

GRIP manages subscriptions and resolves declared dependencies; producers own
their computation and external work. Consumers no longer implement those
coordination mechanisms themselves. React's own guidance on
[dependency arrays](https://react.dev/reference/eslint-plugin-react-hooks/lints/exhaustive-deps)
and [unnecessary effects](https://react.dev/learn/you-might-not-need-an-effect)
describes the corresponding failure patterns.

The form-binding and context hooks are conveniences for editing and composition.
For consuming application state, `useGrip` can be the only hook a component needs.

Larger applications already enforce this discipline through automated tests and
lint checks that reject prohibited React hooks in application code. The same
checks apply to human-written and LLM-generated changes, catching unwanted hook
imports and calls instead of relying on the author to remember the rule. This
keeps state and coordination in GRIP, preserving its testability, inspectability,
and supplier independence as the application grows. Consumers use GRIP hooks;
the React subscription integration stays inside GRIP React.

## React API

All hooks below require an enclosing `GripProvider`.

| API | Use |
| --- | --- |
| `GripProvider` | Supply the runtime and an optional context; defaults to `grok.mainContext`. |
| `GripScope` | Provide an initialized, keyed context to a subtree. |
| `useGrip(grip, ctx?)` | Read a value and subscribe; the result can be `undefined` before a value is available. |
| `useGripSetter(handleGrip, ctx?)` / `useGripUpdater(handleGrip, ctx?)` | Invoke an atom handle's setter or updater. |
| `useGripState(valueGrip, handleGrip, ctx?)` | Read a value and its setter as a tuple. |
| `useSelectGrip`, `useCheckboxGrip`, `useRadioGrip` | Bind form controls to values and their mutators. |
| `useTextGrip`, `useNumberGrip` | Direct text/number bindings with parsing and formatting options. |
| `GripInput`, `GripTextarea`, `useBufferedTextGrip` | Keep a focused edit buffer while publishing changes; useful when normalized values would otherwise disturb editing. |
| `useTap(factory, options?)` | Register a tap in an effect and unregister it on cleanup; explicit dependencies control recreation. |
| `useAtomValueTap(grip, options?)` | Create and register a component-owned atom; specify a handle grip if descendants need its mutator. |
| `useChildContext`, `useKeyedChildContext`, `useKeyedMatchingContext` | Lower-level context creation when the application owns the boundary. |
| `useLocalContext` | Keep the first context for the component lifetime, including when the enclosing parent changes. |
| `useRuntime` | Read the enclosing runtime and context for composition or integration code. |
| `GripGraphVisualizer`, `GraphDumpButton` | Inspect live connections and export graph snapshots. |

### Editing without losing the local draft

`GripInput` and `GripTextarea` use the buffered binding. Valid edits publish on
change by default; `update="blur"` defers publication. While focused, incoming
values do not replace the local draft. On blur, the draft is committed and the
field resumes displaying the stored value. A parser returning `undefined` does
not publish that draft, so unfinished numeric input can remain editable.

See the demo's
[counter](https://github.com/owebeeone/grip-react-demo/blob/main/src/ClockCounterPanel.tsx)
and [description editor](https://github.com/owebeeone/grip-react-demo/blob/main/src/DescriptionEditor.tsx)
for examples of editing, normalization, and computed outputs.

### Scope lifetime

An equal `scopeKey` under the same parent reuses the live context. The same key
under different parents identifies independent scopes. Use mutators to change
values; `init` is not a prop-synchronization callback.

Unmounting a scope does not explicitly retire its context. An external owner
can retain it, while an unreferenced context group may be garbage-collected and
initialized again on later creation. This is live-context reuse, not persistence.
The [scope contract and lifecycle notes](dev-docs/GripScope.md) cover these rules.

## Core producers and further reading

| Factory | Use |
| --- | --- |
| `createAtomValueTap` | Store a value and optionally expose its mutator. |
| `createFunctionTap` | Derive outputs from declared home or destination parameters; optional internal state is also supported. |
| `createAsyncValueTap` / `createAsyncMultiTap` | Retrieve asynchronous outputs with request keys, cancellation, caching, and optional request-state/controller grips. |
| `createAsyncStreamMultiTap` | Produce values from long-lived streams. |
| `withOneOf` and query bindings | Declare conditions that select providers. |

The [core README](https://github.com/owebeeone/grip-core#readme) and
[core source](https://github.com/owebeeone/grip-core/tree/main/src/core)
cover resolution, matching, async request behavior, and streams. Local design
specifications in this repository also record historical proposals; do not treat
an unimplemented proposal as part of the exported API.

See the [scope lifecycle notes](dev-docs/GripScope.md) for initialization and
ownership details when building reusable subtree boundaries.

### Live graph value changes

The graph viewer briefly highlights consumer rows when their displayed values
change, using white text on blue with a gold edge. It holds briefly, then fades away
over 1.5 seconds. Unchanged refreshes and the
initial snapshot do not flash. Row identity and graph layout are preserved.
With reduced motion enabled, the highlight stays static briefly and then clears.
