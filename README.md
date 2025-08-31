

# **grip-react: A Reactive Graph for Unified State Management in React**

grip-react is a powerful, reactive dataflow library that fundamentally decouples an application's components from its data sources. Instead of managing local, derived, and server state with different tools, grip-react provides a single, unified architecture built around a hierarchical "Context Graph." Components simply ask for data by a typed key, and the graph intelligently resolves and delivers it from the most appropriate provider.

## **The Core Philosophy: The Unification of State**

Modern React applications often contend with three distinct categories of state: local UI state, derived state computed from other state, and asynchronous server state. This typically leads to a fragmented toolkit: one library for simple global state (like Zustand), another for complex state machines (like Redux), and a third for server state management (like TanStack Query).

grip-react is built on the architectural thesis that this separation is an artificial complexity. It provides a unified model where all data sources, regardless of their nature, are treated as interchangeable providers within a cohesive system. The library offers distinct but interoperable primitives for each state type: AtomValueTap for local state, FunctionTap for derived state, and BaseAsyncTap for asynchronous server state.1 All of these are resolved through the same core engine (Grok) and Context Graph, allowing developers to swap the underlying implementation of a data source—from a simple mock value to a complex, cached API call—with zero changes to the consuming component.

This design achieves true implementation independence. A React component consumes data using the useGrip hook, which is entirely agnostic about the data's origin. The component only knows

*what* data it needs (identified by a Grip), not *how* or *from where* that data is provided. This abstraction is the library's primary goal: to empower developers to build source-agnostic components that request data via an abstract identifier, allowing the system to handle the complex task of resolution and delivery.1

## **The Core Concepts: Grips, Taps, Drips, and Contexts**

To understand grip-react, one must first grasp four core concepts. An effective analogy is to think of an application's data as a city's water supply.

### **Grip: The Address for Your Data**

A Grip is like a unique street address (e.g., "123 Main St, Apt 4B"). It is a typed, immutable key that points to a specific piece of data but does not contain the data itself. Grips act as the universal identifiers for requesting and providing data within the system.1 They are typically defined centrally in a

GripRegistry to ensure uniqueness and are composed of a scope, name, and an optional defaultValue.1

TypeScript

// From grip-react-demo/src/grips.ts \[1\]  
import { defineGrip } from './runtime';

export const COUNT \= defineGrip\<number\>('Count', 1);

### **Tap: The Source of Your Data**

A Tap is like a water treatment plant or a reservoir. It is a data producer responsible for creating, fetching, or calculating the data for one or more Grips. Taps are classes or factory functions that implement the Tap interface and declare which Grips they provide.1 The library includes different kinds of Taps for different jobs, such as

AtomValueTap for simple values, FunctionTap for derived data, and AsyncTap for remote data.1

### **Drip: The Faucet in Your Component**

A Drip is the faucet in a component. It represents a live, subscribable data stream that a component uses to consume the data provided by a Tap. When the data at the source changes, the Drip automatically delivers the new value to all subscribers. The useGrip hook interacts with a Drip under the hood, managing subscriptions and re-rendering the component upon updates.1

### **Context: The Neighborhood**

A GripContext is like a neighborhood or a district in the city. It provides scope and configuration. A Tap registered in a specific "neighborhood" becomes the default provider for all components within it, unless a component resides in a more specific sub-neighborhood that has its own, closer data source. GripContexts form a Directed Acyclic Graph (DAG), and components can create child contexts to establish isolated scopes. When a component requests a Grip, the engine searches up this graph from the component's current context to find the "closest" Tap that provides it.1

## **Getting Started: Your First Counter**

This tutorial demonstrates how to build a simple, interactive counter, introducing the foundational APIs of grip-react.

### **Step 1: Setup the Provider**

At the root of the application, the component tree must be wrapped with the GripProvider. This component makes the grok engine and the root context available to all descendant components via React's context API.1

TypeScript

// src/main.tsx  
import { GripProvider } from '@owebeeone/grip-react';  
import { grok, main } from './runtime';  
import { createRoot } from 'react-dom/client';  
import App from './App';

const root \= createRoot(document.getElementById('root')\!);  
root.render(  
  \<GripProvider grok={grok} context={main}\>  
    \<App /\>  
  \</GripProvider\>  
);

### **Step 2: Define Your Grips**

Create unique, typed keys for the counter's value and its controller. The value Grip (COUNT) will hold the number, while the handle Grip (COUNT\_TAP) will provide the functions to modify it.1

TypeScript

// src/grips.ts  
import type { AtomTapHandle } from '@owebeeone/grip-react';  
import { defineGrip } from './runtime';

export const COUNT \= defineGrip\<number\>('Count', 1);  
export const COUNT\_TAP \= defineGrip\<AtomTapHandle\<number\>\>('Count.Tap');

### **Step 3: Create a Tap (The Data Source)**

Use the createAtomValueTap factory to create a simple, self-contained state holder. This type of tap, an AtomValueTap, is ideal for local state management. It will *provide* the COUNT value and, because a handleGrip is specified, it will also provide a controller object on the COUNT\_TAP grip.1

TypeScript

// src/taps.ts  
import { createAtomValueTap, type Tap } from '@owebeeone/grip-react';  
import { COUNT, COUNT\_TAP } from './grips';

export const CounterTap: Tap \= createAtomValueTap(  
  COUNT,   
  { initial: COUNT.defaultValue?? 0, handleGrip: COUNT\_TAP }  
);

### **Step 4: Register the Tap**

Inform the grok engine that the CounterTap is available to serve data. Registration makes the tap discoverable by the resolution system.1

TypeScript

// src/taps.ts  
import { grok } from './runtime';

export function registerAllTaps() {  
  grok.registerTap(CounterTap);  
  //... other taps  
}

### **Step 5: Use the Grips in Your Component**

With the system configured, a React component can now consume the state. The useGrip hook reads the live value of COUNT and retrieves the controller object from COUNT\_TAP. The component is completely decoupled from the CounterTap; it only knows about the Grips.1

TypeScript

// src/App.tsx  
import { useGrip } from '@owebeeone/grip-react';  
import { COUNT, COUNT\_TAP } from './grips';

export default function App() {  
  const count \= useGrip(COUNT);  
  const countTap \= useGrip(COUNT\_TAP);

  return (  
    \<div\>  
      \<button onClick={() \=\> countTap?.update(c \=\> (c ?? 0) \- 1)}\>-\</button\>  
      \<span\>Count: {count}\</span\>  
      \<button onClick={() \=\> countTap?.update(c \=\> (c ?? 0) \+ 1)}\>\+\</button\>  
    \</div\>  
  );  
}

This simple example showcases the core workflow: defining abstract data keys (Grips), providing them with a concrete implementation (Tap), and consuming them in a component that remains blissfully unaware of the underlying logic.

## **Understanding the Power of the Context Graph**

The Context Graph is grip-react's most powerful and defining feature. It is more than just a state container; it functions as a runtime Dependency Injection (DI) system for reactive data streams. In a typical DI system, a consumer requests a service by its type or token within a specific scope, and a container provides the appropriate implementation. grip-react mirrors this pattern: a component requests a Grip (the token) within its GripContext (the scope), and the grok engine (the container) traverses the context hierarchy to find the closest registered Tap (the service provider).1 The

useChildContext hook allows for the creation of nested scopes, enabling fine-grained control over which "service" is provided where, facilitating the construction of highly modular and encapsulated applications.1

### **Example: Building Independent Weather Panels**

A practical application of the Context Graph is creating multiple, independent instances of a component. Consider a dashboard displaying weather for several cities side-by-side. Each panel must manage its own location and data without interfering with the others.

The demo application implements this pattern effectively. A WeatherPanel component renders multiple WeatherColumn instances. Crucially, inside each WeatherColumn, the useChildContext hook is called to create an isolated scope.1

TypeScript

// grip-react-demo/src/WeatherColumn.tsx \[1\]  
import { useGrip, useRuntime, useAtomValueTap } from '@owebeeone/grip-react';  
import { useMemo } from 'react';  
import { WEATHER\_LOCATION, WEATHER\_LOCATION\_TAP, WEATHER\_TEMP\_C, WEATHER\_HUMIDITY } from './grips.weather';

export default function WeatherColumn(props: { title: string; initialLocation: string }) {  
  const { context: parentCtx } \= useRuntime();  
  // Create a unique, isolated context for this column instance  
  const ctx \= useMemo(() \=\> parentCtx.getGripConsumerContext().createChild(), \[parentCtx\]);

  // Provide a location value \*inside this specific context\*  
  useAtomValueTap(WEATHER\_LOCATION, {  
    ctx,  
    initial: props.initialLocation,  
    tapGrip: WEATHER\_LOCATION\_TAP,  
  });

  // All these hooks now operate within the isolated 'ctx'  
  const temp \= useGrip(WEATHER\_TEMP\_C, ctx);  
  const humidity \= useGrip(WEATHER\_HUMIDITY, ctx);  
  //...  
}

Without the child context, all WeatherColumn instances would share a single WEATHER\_LOCATION value from their common parent. By creating a new child context for each column, every instance gets its own private scope. The useAtomValueTap call then registers a Tap for WEATHER\_LOCATION *within that specific child context*, effectively localizing the state. This demonstrates how the graph enables true component encapsulation, a pattern that is often cumbersome to achieve with traditional global state managers.

## **Mastering Data Flow with Taps**

Taps are the workhorses of grip-react, providing the logic for all data sources. The library offers specialized taps for different use cases.

### **Asynchronous Taps: Fetching Remote Data**

AsyncTaps are designed for fetching data from external APIs. They provide a comprehensive feature set out-of-the-box, including LRU-TTL caching, request deduplication and coalescing, automatic cancellation via AbortController, and deadline-based timeouts.1 The

createAsyncMultiTap factory allows for a declarative setup, requiring a requestKeyOf function for caching, a fetcher function to perform the request, and a mapResult function to transform the API response into Grip updates.1

TypeScript

// grip-react-demo/src/openmeteo\_taps.ts \[1\]  
import { createAsyncMultiTap, type Tap } from '@owebeeone/grip-react';  
import { GEO\_LAT, GEO\_LNG, GEO\_LABEL, WEATHER\_LOCATION } from './grips.weather';

export function createLocationToGeoTap(): Tap {  
  //...  
  return createAsyncMultiTap({  
    provides:,  
    destinationParamGrips:,  
    cacheTtlMs: 30 \* 60 \* 1000, // Cache for 30 minutes  
    requestKeyOf: (params) \=\> params.get(WEATHER\_LOCATION)?.trim().toLowerCase(),  
    fetcher: async (params, signal) \=\> {   
      const location \= params.get(WEATHER\_LOCATION);  
      const url \= \`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}\`;  
      const res \= await fetch(url, { signal });  
      //... fetch and return data  
    },  
    mapResult: (\_params, r) \=\> new Map(\[ /\*... map result to grips... \*/ \])  
  });  
}

### **Destination Parameters: Inverting Control**

A unique and powerful feature of grip-react is the concept of "destination parameters." This mechanism inverts the typical flow of control for data fetching. In a conventional model, a component *pushes* parameters to the data-fetching hook (e.g., useQuery({ queryKey: \['user', userId\] })). In grip-react, a Tap can declare a dependency on destinationParamGrips. The Tap then *pulls* these parameter values from the context of the component that is consuming its output.1

This inversion of control makes Taps highly reusable, "headless" services. A single, globally registered Tap can be configured implicitly by its consumers through their local contexts. The createLocationToGeoTap is a prime example: it provides geocoding data (GEO\_LAT, GEO\_LNG) but depends on the WEATHER\_LOCATION destination parameter. Each WeatherColumn provides a different WEATHER\_LOCATION in its local context, causing the single geocoding Tap to perform different API calls tailored to each consumer.1

### **Derived State with FunctionTap**

FunctionTap is the grip-react equivalent of selectors (like in Redux) or derived atoms. It subscribes to one or more input Grips and computes an output Grip. Whenever an input Grip changes, the compute function re-runs automatically, updating the output.1 This is ideal for transformations, calculations, and filtering logic that needs to remain reactive. The

anchorscad-viewer demo utilizes this pattern to derive navigation lists from a raw JSON data source.1

TypeScript

// anchorscad-viewer/src/taps.ts \[1\]  
import { createFunctionTap } from '@owebeeone/grip-react';  
import { ALL\_MODULES\_LIST, RAW\_STATUS\_JSON } from './grips';

export function createGlobalNavigationDataProviderTap(): Tap {  
  return createFunctionTap({  
    provides:,  
    homeParamGrips:,  
    compute: ({ getHomeParam }) \=\> {  
      const status \= getHomeParam(RAW\_STATUS\_JSON);  
      const updates \= new Map();  
      if (status) {  
        const modules \= (status.module\_status ||).filter((m: any) \=\> m.shape\_results?.length \> 0);  
        updates.set(ALL\_MODULES\_LIST, modules);  
      }  
      return updates;  
    },  
  });  
}

## **Dynamic Systems with Declarative Queries**

Instead of embedding conditional logic within components to switch between data sources, grip-react provides a declarative query system. This system allows developers to define rules that bind specific Taps to certain application states. The grok engine evaluates these rules and automatically activates the correct Tap when the state changes.1

This approach elevates configuration to a "policy" level. The rules governing which data source to use are defined centrally, completely separate from the application's presentation logic. This is an extremely powerful pattern for implementing feature flags, A/B testing, or managing different environments (e.g., Storybook, testing, production) without cluttering components with conditional data-fetching logic. A component simply requests data with useGrip, and the query system ensures the correct provider is active behind the scenes.

### **Example: Switching Between Mock and Live Weather Data**

The demo application uses this system to seamlessly switch between a mock weather Tap and a live API-driven Tap. The switch is controlled by the value of the WEATHER\_PROVIDER\_NAME Grip.1

TypeScript

// grip-react-demo/src/taps.ts \[1\]  
import { withOneOf } from '@owebeeone/grip-react';  
import { WEATHER\_PROVIDER\_NAME } from './grips';

export function registerAllTaps() {  
  //...  
  // When WEATHER\_PROVIDER\_NAME is 'mock', activate the mock WeatherTap.  
  const mockQuery \= withOneOf(WEATHER\_PROVIDER\_NAME, 'mock', 10).build();  
  grok.addBinding({   
    id: 'mock-weather-binding',   
    query: mockQuery,   
    tap: WeatherTap, // The mock implementation  
    baseScore: 5   
  });

  // When WEATHER\_PROVIDER\_NAME is 'meteo', activate the live OpenMeteo tap factory.  
  const meteoQuery \= withOneOf(WEATHER\_PROVIDER\_NAME, 'meteo', 10).build();  
  grok.addBinding({   
    id: 'meteo-weather-binding',   
    query: meteoQuery,   
    tap: METEO\_TAP\_FACTORY, // The live implementation  
    baseScore: 5   
  });  
}

By simply changing the value of the WEATHER\_PROVIDER\_NAME Grip—which is controlled by buttons in the UI—the entire data source for the weather panels is swapped transparently, without any of the consuming components being aware of the change.

## **How grip-react Compares**

grip-react unifies concepts that are often handled by separate, specialized libraries. The following comparison clarifies its architectural trade-offs and unique position in the React ecosystem.

### **Feature Comparison Table**

| Feature | grip-react | Zustand | Redux Toolkit | TanStack Query |
| :---- | :---- | :---- | :---- | :---- |
| **Primary Use Case** | Unified Data Flow (Local, Derived, Server) | Simple Global State | Predictable, Structured Global State | Server State (Fetching, Caching) |
| **State Model** | Decentralized Graph (Taps) | Centralized Store (Slice) | Centralized Store (Slices/Reducers) | Centralized Cache (Query Keys) |
| **Async State** | Built-in (AsyncTap) | Middleware or manual useEffect | Thunks / RTK Query | Core feature (useQuery, useMutation) |
| **Context-Awareness** | Core feature (Context Graph, Dest Params) | Not built-in | Not built-in | Via queryKey parameters |
| **Boilerplate** | Moderate (Grips, Taps) | Very Low | High (Slices, Actions, Reducers) | Low |
| **Key Differentiator** | Unified graph model for all state types | Simplicity and minimalism | DevTools and predictable state changes | Advanced server state management features |

### **Side-by-Side: Simple State (vs. Zustand)**

Zustand excels at providing simple, low-boilerplate global state.2

**Zustand Example**

JavaScript

// store.js  
import { create } from 'zustand';

const useCountStore \= create((set) \=\> ({  
  count: 0,  
  increment: () \=\> set((state) \=\> ({ count: state.count \+ 1 })),  
}));

// Component.js  
import { useCountStore } from './store';

function Counter() {  
  const { count, increment } \= useCountStore();  
  return \<button onClick\={increment}\>{count}\</button\>;  
}

**grip-react Example**

JavaScript

// grips.js  
export const COUNT \= defineGrip('Count', 0);  
export const COUNT\_TAP \= defineGrip('Count.Tap');

// taps.js  
export const CounterTap \= createAtomValueTap(COUNT, { handleGrip: COUNT\_TAP });

// Component.js  
function Counter() {  
  const count \= useGrip(COUNT);  
  const countTap \= useGrip(COUNT\_TAP);  
  return \<button onClick\={() \=\> countTap.update(c \=\> c \+ 1)}\>{count}\</button\>;  
}

**Analysis:** For a single global value, Zustand is undeniably more concise. However, grip-react's architecture is designed for contextual scalability. To create multiple, independent counters with Zustand, one would need to use its non-hook createStore API and manually wire it through React Context or props, re-introducing boilerplate. grip-react handles this scenario natively with its Context Graph (useChildContext). grip-react trades a small amount of initial setup for superior contextual control and modularity as application complexity grows.

### **Side-by-Side: Structured State (vs. Redux Toolkit)**

Redux Toolkit provides a strict, predictable pattern for managing complex, centralized state.7

**Redux Toolkit Example**

JavaScript

// features/counter/counterSlice.js  
import { createSlice } from '@reduxjs/toolkit';

export const counterSlice \= createSlice({  
  name: 'counter',  
  initialState: { value: 0 },  
  reducers: { increment: (state) \=\> { state.value \+= 1; } },  
});  
export const { increment } \= counterSlice.actions;  
export default counterSlice.reducer;

// app/store.js  
import { configureStore } from '@reduxjs/toolkit';  
import counterReducer from '../features/counter/counterSlice';

export const store \= configureStore({ reducer: { counter: counterReducer } });

// components/Counter.js  
import { useSelector, useDispatch } from 'react-redux';  
import { increment } from '../features/counter/counterSlice';

function Counter() {  
  const count \= useSelector((state) \=\> state.counter.value);  
  const dispatch \= useDispatch();  
  return \<button onClick\={() \=\> dispatch(increment())}\>{count}\</button\>;  
}

**grip-react Example:** The counter example remains the same. For more complex, structured state, one would compose multiple AtomTaps or use a MultiAtomValueTap or FunctionTap.

**Analysis:** Redux offers a robust, monolithic state tree with excellent debugging capabilities like time-travel. grip-react achieves predictability through its deterministic graph resolution. The primary architectural difference is that Redux enforces a single, centralized store, whereas grip-react promotes a decentralized graph of many small, independent state producers (Taps). This allows grip-react to offer similar predictability to Redux but without the high boilerplate and the architectural constraints of a single global store, leading to more modular and context-aware state management.

### **Side-by-Side: Server State (vs. TanStack Query)**

TanStack Query is the de facto standard for server state management in React, offering a rich set of features for data fetching, caching, and synchronization.13

**TanStack Query Example**

JavaScript

// components/User.js  
import { useQuery } from '@tanstack/react-query';

function User({ userId }) {  
  const { data, isLoading, error } \= useQuery({  
    queryKey: \['user', userId\],  
    queryFn: () \=\> fetch(\`/api/users/${userId}\`).then(res \=\> res.json()),  
  });

  if (isLoading) return 'Loading...';  
  if (error) return \`Error: ${error.message}\`;  
  return \<div\>{data.name}\</div\>;  
}

**grip-react Example**

JavaScript

// grips.js  
const USER\_ID \= defineGrip('user\_id');  
const USER\_DATA \= defineGrip('user\_data');

// taps.js  
const UserDataTap \= createAsyncValueTap({  
  provides: USER\_DATA,  
  destinationParamGrips:,  
  requestKeyOf: (params) \=\> \`user:${params.get(USER\_ID)}\`,  
  fetcher: (params) \=\> fetch(\`/api/users/${params.get(USER\_ID)}\`).then(res \=\> res.json()),  
});

// components/User.js  
function User({ userId }) {  
  const ctx \= useChildContext();  
  // Provide the userId in the local context  
  useAtomValueTap(USER\_ID, { ctx, initial: userId });  
  // Request the user data from that context  
  const data \= useGrip(USER\_DATA, ctx);  
  //... handle loading/error states (can be provided by the tap)  
  return \<div\>{data?.name}\</div\>;  
}

**Analysis:** Both libraries offer sophisticated caching, deduplication, and status tracking. The fundamental difference lies in how they are parameterized. TanStack Query embeds parameters directly into the queryKey, tightly coupling the data request to its dependencies. grip-react, through its destination parameters feature, decouples the parameter (USER\_ID) from the data request (USER\_DATA) by placing the parameter in the context graph. This makes grip-react's Taps more abstract, reusable, and composable. Furthermore, it unifies server state with all other state types in the application; a component can ask for USER\_DATA without needing to know it is asynchronous, whereas with TanStack Query, the async nature is explicit in the useQuery hook.

## **API Reference & Installation**

### **Installation**

Use the next tag to install the latest 0.1.x release:

```bash
npm install @owebeeone/grip-react@next
# or
yarn add @owebeeone/grip-react@next
```

### **Core Hooks**

* useGrip(grip, \[context\]): Reads a reactive value from the specified Grip. Subscribes the component to updates.1  
* useTap(factory, \[options\]): Registers a Tap instance for the component's lifecycle. The Tap is created using the factory function and is automatically unregistered on unmount.1  
* useChildContext(\[parentContext\]): Creates a new, isolated child GripContext that inherits from the parent.1  
* useGripSetter(handleGrip, \[context\]): A convenience hook that retrieves a Tap handle and returns a stable setter function for updating its state.1  
* useGripState(valueGrip, handleGrip, \[context\]): Provides a useState-like API \[value, setValue\] for a Grip controlled by an AtomTap.1

### **Core Factories**

* GripRegistry and GripOf(registry): Define and register new Grip instances.  
* createAtomValueTap(valueGrip, \[options\]): Creates a Tap for managing simple, atom-style local state.1  
* createFunctionTap(config): Creates a Tap for deriving state from one or more input Grips.1  
* createAsyncValueTap(config) / createAsyncMultiTap(config): Creates Taps for handling asynchronous operations like API calls, with built-in support for caching, cancellation, and more.1
