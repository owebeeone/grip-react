# GRIP React release notes

## 0.3.0

### Added

- `GripScope`: an initialized, keyed context boundary for a React subtree.
  Scope keys identify UI instances; changing their data does not replace the
  context. Initialization runs when a new live keyed context is created.
- Live graph layout and legend improvements, including shared scaling for
  cards and text and configurable layout direction.
- Complete weather and counter examples, executable composition and isolation
  tests, and guidance for incremental adoption and LLM-assisted implementation.

### Fixed

- Abandoned populated scopes can be collected without being retained by the
  engine's graph index. Live children retain their inherited providers, and
  detached taps release their parameter context.
- Graph inspection stores display data instead of retaining live drips,
  producer records, or handle values that would keep contexts alive.

### GripScope availability

`GripScope` is introduced in `@owebeeone/grip-react@0.3.0`, with runtime exports
for both module formats and TypeScript declarations. This release depends on
the published `@owebeeone/grip-core@^0.3.0` package.

### Release preparation

- GRIP Core must be published before releasing this package. The React package
  uses the registry dependency rather than a development workspace path.
- Verify that the packed React package exports `GripScope` in both module
  formats and its TypeScript declarations, and runs the examples against that
  published core dependency.
