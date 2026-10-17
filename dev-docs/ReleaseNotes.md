# GRIP React release notes

## Next release

### Added

- `GripScope`: an initialized, keyed context boundary for a React subtree.
  Scope keys identify UI instances; changing their data does not replace the
  context. Initialization runs when a new live keyed context is created.
- Live graph layout and legend improvements, including shared scaling for
  cards and text and configurable layout direction.
- Complete weather and counter examples, executable composition and isolation
  tests, and guidance for incremental adoption and LLM-assisted implementation.

### GripScope availability

`GripScope` is introduced in this release. It is implemented and exported in
the source tree; it is not part of the previously published `0.2.0` package.
Assign the release version to this heading when preparing publication so the
published release identifies the first version containing the component.

### Release preparation

- Publish the updated GRIP core and use its published version in the React
  package dependency instead of the development workspace path.
- Verify that the packed React package exports `GripScope` in both module
  formats and its TypeScript declarations, and runs the examples against that
  published core dependency.
- Replace "Next release" with the assigned version before publication.
