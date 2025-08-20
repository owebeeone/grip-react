

* Make the naked `new GripContext(..)` illegal so that we force the use of Grok or a parent context.

### Core engine and resolver
- Track grips per tap per context so unregister is exact (no cache-key scan). Use resolver.unregisterLocalProvider(ctxId, gripKey).
- Add resolver tests for multi-parent DAGs and priority overshadowing (same/different priorities).
- Ensure resolver mappings update when parent links change post-creation; avoid doing setParents inside query.
- Consider exposing a read-only debug snapshot of resolver state for tests/devtools.

### Tap API and lifecycle
- Implement connection-based production (onConnect/onDisconnect with per-context sinks) to avoid creating new drips on re-query.
- Support multi-output taps efficiently (deliver to multiple grips via sinks, not per-grip drips).
- Manage parameterGrips lifecycle: subscribe/unsubscribe tied to consumer presence; avoid leaks.
- Provide an AtomTap helper for trivial app state (backed by a Drip), and deprecate direct setValue in favor of setDrip.

### Context lifecycle and graph
- Provide API to unregister a tap at a specific context: unregisterTapAt(ctx, tapId).
- Strengthen GC: ensure GrokGraph removes nodes when contexts are reaped and there are no live consumers; avoid cleanup during delivery.
- Optionally re-introduce per-node indices (localProviders/resolvedMap/dripByGrip) or document why resolver centralization suffices.

### React integration
- Add `useChildContext(init?)` to allow creating a child with initial overrides atomically.
- Consider `useContextWithGrok` that creates contexts via Grok to auto-register parents with resolver.

### Tests
- Expand engine tests for:
  - Multi-parent and priority overshadowing.
  - Parameter-driven invalidation with multiple parameterGrips.
  - Override precedence vs tap at equal/ancestor distances.
  - Disposal: disposeContext clears caches for that ctx; ensure subsequent query re-resolves.
  - Shared drip semantics across multiple consumers in same/different contexts.

### Demo cleanup
- WeatherTap: declare `parameterGrips: [WEATHER_LOCATION]` for clarity; manage per-location interval lifecycles (refcount or onFirst/Zero).
- Remove demo-side `__weatherCache` hack or encapsulate it cleanly.

### Packaging and DX
- Fix package.json `sideEffects`: set boolean false (no quotes).
- Update GRIP_RESOLVER.md to reflect current engine wiring and planned sink-based API.
- Publish a small “Getting Started” with examples (counter, calculator, weather).