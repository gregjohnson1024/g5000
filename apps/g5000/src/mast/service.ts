import { readFile } from 'node:fs/promises';
import { BehaviorSubject, filter, map, type Observable } from 'rxjs';
import {
  DEFAULT_MAST_LAYOUT,
  knownChannelSet,
  validateMastLayout,
  type MastLayout,
  type MastRuntime,
} from '@g5000/mast';
import type { ConfigStore } from '@g5000/db';

/**
 * Thin shell over ConfigStore: seeds the mast layout once at boot (from the
 * git-tracked layout file, or DEFAULT_MAST_LAYOUT as a fallback), then
 * delegates layout$/getLayout to ConfigStore. Holds the transient
 * active-page override in-memory. Pure layout logic lives in @g5000/mast;
 * the DB persistence layer lives in @g5000/db.
 */
export class MastService implements MastRuntime {
  private readonly overrideSubject = new BehaviorSubject<string | null>(null);

  private constructor(private readonly configStore: ConfigStore) {}

  static async start(configStore: ConfigStore, layoutPath: string): Promise<MastService> {
    if (configStore.getMastLayout() === null) {
      // Not yet seeded — try to read the file and validate it.
      const known = knownChannelSet();
      let seed: MastLayout = DEFAULT_MAST_LAYOUT;
      let source = 'DEFAULT_MAST_LAYOUT (file missing)';
      let text: string | null = null;
      try {
        text = await readFile(layoutPath, 'utf-8');
      } catch {
        // File missing — keep seed = DEFAULT_MAST_LAYOUT.
      }
      if (text !== null) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          console.error(
            `[mast] ${layoutPath}: invalid JSON, falling back to DEFAULT_MAST_LAYOUT:`,
            (e as Error).message,
          );
          source = 'DEFAULT_MAST_LAYOUT (invalid JSON)';
          parsed = null;
        }
        if (parsed !== null) {
          const result = validateMastLayout(parsed, known);
          if (!result.ok) {
            console.error(
              `[mast] ${layoutPath}: invalid layout, falling back to DEFAULT_MAST_LAYOUT:\n  - ${result.errors.join('\n  - ')}`,
            );
            source = 'DEFAULT_MAST_LAYOUT (invalid layout)';
          } else {
            seed = result.layout;
            source = `${layoutPath} (${result.layout.pages.length} page(s))`;
          }
        }
      }
      await configStore.setMastLayout(seed);
      console.log(`[mast] seeded layout from ${source}`);
    } else {
      console.log('[mast] layout already in ConfigStore, skipping seed');
    }
    return new MastService(configStore);
  }

  get layout$(): Observable<MastLayout> {
    return this.configStore.mastLayout$.pipe(filter((l): l is MastLayout => l !== null));
  }

  get override$(): Observable<string | null> {
    return this.overrideSubject.asObservable();
  }

  /** Returns the live layout by reference — callers MUST treat it as read-only. */
  getLayout(): MastLayout {
    return this.configStore.getMastLayout() ?? DEFAULT_MAST_LAYOUT;
  }

  getOverride(): string | null {
    return this.overrideSubject.value;
  }

  setOverride(pageId: string | null): void {
    this.overrideSubject.next(pageId);
  }

  get brightness$(): Observable<number> {
    return this.configStore.displayConfig$.pipe(map((c) => c.brightnessPct));
  }

  getBrightness(): number {
    return this.configStore.getDisplayConfig().brightnessPct;
  }

  get nightMode$(): Observable<boolean> {
    return this.configStore.displayConfig$.pipe(map((c) => c.nightMode));
  }

  getNightMode(): boolean {
    return this.configStore.getDisplayConfig().nightMode;
  }

  async stop(): Promise<void> {
    this.overrideSubject.complete();
    // ConfigStore's subjects are owned by ConfigStore; we do not complete them here.
  }
}
