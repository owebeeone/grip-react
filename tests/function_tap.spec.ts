import { describe, it, expect } from 'vitest';
import { Grok } from '../src/core/grok';
import { GripRegistry, GripOf, Grip } from '../src/core/grip';
import { createAtomValueTap } from '../src/core/atom_tap';
import type { AtomTap } from '../src/core/atom_tap';
import { createFunctionTap, FunctionTap } from '../src/core/function_tap';
import type { FunctionTapHandle } from '../src/core/function_tap';
import { DualContextContainer } from '../src/core/containers';

// Global grips reused across tests
const registry = new GripRegistry();
const defineGrip = GripOf(registry);

// Outputs
const VALUE = defineGrip<number>('Fn.Value', 0);
const VALUE_STR = defineGrip<string>('Fn.ValueStr', '');

// Destination param (operation)
const OP = defineGrip<string>('Fn.Op', '+');
const OP_HANDLE = defineGrip<AtomTap<string>>('Fn.Op.Handle');

// Home param (A)
const A = defineGrip<number>('Fn.A', 0);

// Local state (B) and handle
const B = defineGrip<number>('Fn.B', 0);
const HANDLE = defineGrip<FunctionTapHandle<{ b: typeof B }>>('Fn.Handle');

type Outs = { value: typeof VALUE; text: typeof VALUE_STR };
type Home = { a: typeof A };
type Dest = { op: typeof OP };
type StateRec = { b: typeof B };

// Global typed tap factory (we still create instances per test to avoid graph sharing)
const makeFnTap = () => createFunctionTap<Outs, Home, Dest, StateRec>({
  provides: [VALUE, VALUE_STR],
  homeParamGrips: [A],
  destinationParamGrips: [OP],
  handleGrip: HANDLE,
  initialState: [[B, 0]],
  compute: ({ dest, getHomeParam, getDestParam, getState }) => {
    const a = getHomeParam(A) ?? 0;
    const b = getState(B) ?? 0;
    const op = getDestParam(OP, dest) ?? '+';
    let res = 0;
    switch (op) {
      case '+': res = a + b; break;
      case '-': res = a - b; break;
      case '*': res = a * b; break;
      case '/': res = b === 0 ? Infinity : a / b; break;
      default: res = a + b;
    }
    const txt = `${a} ${op} ${b} = ${res}`;
    return new Map<Grip<any>, any>([[VALUE, res], [VALUE_STR, txt]]);
  },
});

describe('FunctionTap', () => {
  it('computes outputs from home param, destination param, and local state; updates on changes', () => {
    const grok = new Grok();
    const P = grok.mainContext.createChild();
    const D1 = P.createChild();
    const D2 = P.createChild();

    // Home param A provider at P
    const aTap = createAtomValueTap(A, { initial: 10 }) as unknown as AtomTap<number>;
    grok.registerTapAt(P, aTap as any);

    // Destination param OP provider at D2 only (so D1 uses default '+')
    const opTapD2 = createAtomValueTap(OP, { initial: '*' , handleGrip: OP_HANDLE }) as unknown as AtomTap<string>;
    grok.registerTapAt(D2, opTapD2 as any);

    // Create function tap at P
    const fnTap = makeFnTap();
    grok.registerTapAt(P, fnTap);

    // Connect consumers
    const d1Num = grok.query(VALUE, D1);
    const d1Str = grok.query(VALUE_STR, D1);
    const d2Num = grok.query(VALUE, D2);
    const d2Str = grok.query(VALUE_STR, D2);

    // Initial: A=10, B=0, D1 op '+', D2 op '*'
    expect(d1Num.get()).toBe(10);
    expect(d1Str.get()).toBe('10 + 0 = 10');
    expect(d2Num.get()).toBe(0);
    expect(d2Str.get()).toBe('10 * 0 = 0');

    // Update local state B via handle
    const handle = grok.query(HANDLE, D1).get()!;
    handle.setState(B, 7);
    grok.flush();
    expect(grok.query(VALUE, D1).get()).toBe(17); // 10 + 7
    expect(grok.query(VALUE_STR, D1).get()).toBe('10 + 7 = 17');
    expect(grok.query(VALUE, D2).get()).toBe(70); // 10 * 7
    expect(grok.query(VALUE_STR, D2).get()).toBe('10 * 7 = 70');

    // Change home param A to 2
    (aTap as any).set(2);
    grok.flush();
    expect(grok.query(VALUE, D1).get()).toBe(9); // 2 + 7
    expect(grok.query(VALUE, D2).get()).toBe(14); // 2 * 7

    // Change destination param OP at D2 to '-'
    const opHandleD2 = grok.query(OP_HANDLE, D2).get()!;
    opHandleD2.set('-');
    grok.flush();
    expect(grok.query(VALUE, D2).get()).toBe(2 - 7);
    expect(grok.query(VALUE_STR, D2).get()).toBe('2 - 7 = -5');
  });

  it('supports DualContext: separate home params and per-destination ops across multiple destinations', () => {
    const grok = new Grok();
    // Create a dual context where home params live in home, and outputs in presentation
    const container = grok.createDualContext(grok.mainContext);
    const home = container.getGripHomeContext();
    const destRoot = container.getGripConsumerContext();

    // Home param A provided at home
    const aTap = createAtomValueTap(A, { initial: 3 }) as unknown as AtomTap<number>;
    grok.registerTapAt(home, aTap as any);

    // Function tap attached at home
    const fnTap = makeFnTap();
    grok.registerTapAt(container, fnTap);

    // Two destination contexts under presentation
    const CD1 = destRoot.createChild();
    const CD2 = destRoot.createChild();

    // Destination OP providers at each dest
    const opTap1 = createAtomValueTap(OP, { initial: '*' , handleGrip: OP_HANDLE }) as unknown as AtomTap<string>;
    const opTap2 = createAtomValueTap(OP, { initial: '-' , handleGrip: OP_HANDLE }) as unknown as AtomTap<string>;
    grok.registerTapAt(CD1, opTap1 as any);
    grok.registerTapAt(CD2, opTap2 as any);

    // Connect consumers
    const cd1Num = grok.query(VALUE, CD1);
    const cd2Num = grok.query(VALUE, CD2);

    // Initial: A=3, B=0, CD1 '*', CD2 '-'
    expect(cd1Num.get()).toBe(0);
    expect(cd2Num.get()).toBe(3);

    // Update local state B via handle from CD1 (handle is visible there)
    const handle1 = grok.query(HANDLE, CD1).get()!;
    handle1.setState(B, 5);
    grok.flush();
    expect(grok.query(VALUE, CD1).get()).toBe(15); // 3 * 5
    expect(grok.query(VALUE, CD2).get()).toBe(-2); // 3 - 5

    // Change A at home; both recompute
    (aTap as any).set(10);
    grok.flush();
    expect(grok.query(VALUE, CD1).get()).toBe(50); // 10 * 5
    expect(grok.query(VALUE, CD2).get()).toBe(5);  // 10 - 5

    // Swap ops: CD1 '/', CD2 '+'; validate
    const opH1 = grok.query(OP_HANDLE, CD1).get()!;
    const opH2 = grok.query(OP_HANDLE, CD2).get()!;
    opH1.set('/');
    opH2.set('+');
    grok.flush();
    expect(grok.query(VALUE, CD1).get()).toBe(2);   // 10 / 5
    expect(grok.query(VALUE, CD2).get()).toBe(15);  // 10 + 5
  });
});


