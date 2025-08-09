// A Grip is a typed key (with optional scope) + default
export class Grip<T> {
    readonly scope: string;
    readonly name: string;
    readonly key: string;           // scope:name
    readonly defaultValue?: T;
  
    constructor(opts: { scope?: string; name: string; defaultValue?: T }) {
      this.scope = opts.scope ?? "app";
      this.name = opts.name;
      this.key = `${this.scope}:${this.name}`;
      this.defaultValue = opts.defaultValue;
    }
  }
  
  export class GripRegistry {
    private grips = new Map<string, Grip<any>>();
  
    defineGrip<T>(name: string, defaultValue?: T, scope?: string): Grip<T> {
      const g = new Grip<T>({ scope, name, defaultValue });
      if (this.grips.has(g.key)) throw new Error(`Grip already registered: ${g.key}`);
      this.grips.set(g.key, g);
      return g;
    }
  
    get<T>(scope: string, name: string): Grip<T> | undefined {
      // TODO: add a check to see if the requested type is the same as the defined type.
      return this.grips.get(`${scope}:${name}`) as Grip<T> | undefined;
    }
  }
  
  // Convenience factory (matches your “GripOf = λ registry.register” idea)
  export const GripOf = (registry: GripRegistry) =>
    <T>(name: string, defaultValue?: T, scope?: string) =>
      registry.defineGrip<T>(name, defaultValue, scope);
  