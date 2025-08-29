import { consola } from 'consola';
import { Grip } from './core/grip';
import { GripContext } from './core/context';

/**
 * A Grip that holds a map of enabled log tags.
 * The key is the tag (file path) and the value is a boolean indicating if it's enabled.
 * A special tag '*' can be used to enable all logs.
 */
export const LOGGING_TAGS_GRIP = new Grip<Map<string, boolean>>('logging:tags', new Map());

export function setupConsola(context: GripContext) {
  if (process.env.NODE_ENV === 'production') {
    consola.setReporters({ log: () => {} }); // Disable logs in production
    return;
  }

  let enabledTags = new Map<string, boolean>();

  const drip = context.getDrip(LOGGING_TAGS_GRIP);

  drip.subscribe((tagsMap) => {
    enabledTags = tagsMap || new Map();
  });

  const customReporter = {
    log: (logObj: any) => {
      const tag = logObj.tag;
      // Log if:
      // 1. The log has no tag.
      // 2. The specific tag is enabled in the map.
      // 3. The wildcard '*' tag is enabled.
      if (!tag || enabledTags.get(tag) || enabledTags.get('*')) {
        // Create a new consola instance to avoid recursive calls to this reporter.
        // This new instance will have the default reporters.
        new (consola as any).constructor().log(logObj);
      }
    },
  };

  consola.setReporters([customReporter]);
}
