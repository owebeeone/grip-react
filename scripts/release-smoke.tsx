import {
  GripInput,
  GripOf,
  GripRegistry,
  GripScope,
  createAtomValueTap,
} from '@owebeeone/grip-react';

const defineGrip = GripOf(new GripRegistry());
const VALUE = defineGrip<number>('Release.Value');

// Compiled from an isolated consumer of the packed package, not local source.
export const scope = (
  <GripScope scopeKey="release-smoke" init={context => {
    context.getGripHomeContext().registerTap(createAtomValueTap(VALUE, { initial: 1 }));
  }}>
    <output />
  </GripScope>
);

export const bufferedInput = GripInput;
