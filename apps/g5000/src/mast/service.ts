import { readFile } from 'node:fs/promises';
import { watch, type FSWatcher } from 'chokidar';
import { BehaviorSubject, type Observable } from 'rxjs';
import {
  DEFAULT_MAST_LAYOUT,
  knownChannelSet,
  validateMastLayout,
  type MastLayout,
  type MastRuntime,
} from '@g5000/mast';

/**
 * Owns the git-tracked mast-layout.json: loads + validates it at startup, hot-reloads
 * it on file change (keeping the last good layout on invalid edits), and holds the
 * transient active-page override. Pure layout logic lives in @g5000/mast; this is the
 * Node/fs/RxJS shell.
 */
export class MastService implements MastRuntime {
  private readonly layoutSubject: BehaviorSubject<MastLayout>;
  private readonly overrideSubject = new BehaviorSubject<string | null>(null);
  private readonly known = knownChannelSet();
  private watcher: FSWatcher | null = null;

  private constructor(
    private readonly filePath: string,
    initial: MastLayout,
  ) {
    this.layoutSubject = new BehaviorSubject<MastLayout>(initial);
  }

  static async start(filePath: string): Promise<MastService> {
    const svc = new MastService(filePath, DEFAULT_MAST_LAYOUT);
    await svc.reloadNow();
    svc.watcher = watch(filePath, { ignoreInitial: true });
    svc.watcher.on('add', () => void svc.reloadNow());
    svc.watcher.on('change', () => void svc.reloadNow());
    return svc;
  }

  /** Read + validate the file; on success swap the layout, on failure keep the last good one. */
  async reloadNow(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf-8');
    } catch {
      // Missing file: keep current (DEFAULT on first load).
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error(`[mast] ${this.filePath}: invalid JSON, keeping last good layout:`, (e as Error).message);
      return;
    }
    const result = validateMastLayout(parsed, this.known);
    if (!result.ok) {
      console.error(`[mast] ${this.filePath}: invalid layout, keeping last good layout:\n  - ${result.errors.join('\n  - ')}`);
      return;
    }
    this.layoutSubject.next(result.layout);
    console.log(`[mast] loaded layout with ${result.layout.pages.length} page(s)`);
  }

  get layout$(): Observable<MastLayout> {
    return this.layoutSubject.asObservable();
  }
  get override$(): Observable<string | null> {
    return this.overrideSubject.asObservable();
  }
  getLayout(): MastLayout {
    return this.layoutSubject.value;
  }
  getOverride(): string | null {
    return this.overrideSubject.value;
  }
  setOverride(pageId: string | null): void {
    this.overrideSubject.next(pageId);
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
    this.watcher = null;
  }
}
