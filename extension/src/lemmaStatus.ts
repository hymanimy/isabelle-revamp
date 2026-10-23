import { join } from 'node:path';
import { DecorationOptions, DiagnosticSeverity, Disposable, languages, MarkdownString, Range, TextDocument, TextEditor,
  TextEditorDecorationType, Uri, window, workspace } from 'vscode';
import { busyTypes, Goals, SourceRange } from './goals';
import { outline, OutlineItem } from './outline';

// A mark in the gutter beside each lemma, definition and type: ✓ checked, an amber
// ring for sorry or oops, ✗ for an error. Nothing while any part is unchecked.
export type LemmaState = 'checked' | 'unfinished' | 'error';
const marked = new Set(['theorem', 'definition', 'type', 'datatype', 'constant']);

const before = (a: number[], b: number[]) => a[0] < b[0] || a[0] === b[0] && a[1] < b[1];
const overlaps = (a: SourceRange, b: SourceRange) => before([b[0], b[1]], [a[2], a[3]]) && before([a[0], a[1]], [b[2], b[3]]);

export function lemmaState(range: SourceRange, marks: { errors: SourceRange[]; busy: SourceRange[]; admissions: SourceRange[] }):
  LemmaState | undefined {
  const within = (ranges: SourceRange[]) => ranges.some(other => overlaps(range, other));
  if (within(marks.errors)) return 'error';
  if (within(marks.busy)) return undefined;
  return within(marks.admissions) ? 'unfinished' : 'checked';
}

// The outline entries that get a mark, at any depth.
export function markedItems(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap(item => [...marked.has(item.kind) ? [item] : [], ...markedItems(item.children)]);
}

export class LemmaStatus implements Disposable {
  private types: Record<LemmaState, TextEditorDecorationType>;
  private shown = new WeakMap<TextEditor, string>();
  private outlines = new WeakMap<TextDocument, { version: number; items: OutlineItem[] }>();
  // Snapshot requests per file, at most ten for each version.
  private requested = new Map<string, { version: number; count: number; at: number }>();
  private timer?: ReturnType<typeof setTimeout>;
  private subscriptions: Disposable[];

  constructor(private goals: Goals, extensionPath: string) {
    const type = (icon: string) => window.createTextEditorDecorationType({
      gutterIconPath: Uri.file(join(extensionPath, 'media', `status-${icon}.svg`)), gutterIconSize: 'contain' });
    this.types = { checked: type('checked'), unfinished: type('unfinished'), error: type('error') };
    const schedule = () => this.schedule();
    this.subscriptions = [goals.onDidUpdate(schedule), window.onDidChangeVisibleTextEditors(schedule),
      languages.onDidChangeDiagnostics(schedule),
      workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('isabelleRevamp.lemmaStatus')) schedule(); })];
    this.schedule();
  }

  private schedule(delay = 150): void {
    this.timer ??= setTimeout(() => { this.timer = undefined; this.update(); }, delay);
  }

  private items(document: TextDocument): OutlineItem[] {
    const cached = this.outlines.get(document);
    if (cached?.version === document.version) return cached.items;
    const items = markedItems(outline(document.getText()));
    this.outlines.set(document, { version: document.version, items });
    return items;
  }

  private update(): void {
    for (const editor of window.visibleTextEditors) {
      const document = editor.document;
      if (document.languageId !== 'isabelle') continue;
      if (!workspace.getConfiguration('isabelleRevamp', document).get('lemmaStatus', true)) {
        if (this.shown.has(editor)) Object.values(this.types).forEach(type => editor.setDecorations(type, []));
        this.shown.delete(editor);
        continue;
      }
      // Until Isabelle has reported on this version, keep the marks: they move with edits.
      if (!this.goals.decorationsCurrent(document)) {
        const uri = document.uri.toString();
        let asked = this.requested.get(uri);
        if (asked?.version !== document.version) this.requested.set(uri, asked = { version: document.version, count: 0, at: 0 });
        if (asked.count < 10 && Date.now() - asked.at > 1000) {
          asked.count++; asked.at = Date.now();
          this.goals.requestDecorations(document);
        }
        // The snapshot's arrival schedules an update; look again in case none comes.
        if (asked.count < 10) this.schedule(1100);
        continue;
      }
      const errors = languages.getDiagnostics(document.uri).filter(d => d.severity === DiagnosticSeverity.Error);
      const admissions = this.goals.admissionPositions(document);
      const marks = {
        // Diagnostics can trail the decorations that report the same check, so failed
        // commands come from both: otherwise a failing lemma could flash a tick.
        errors: [...errors.map(d => [d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character] as SourceRange),
          ...this.goals.decorationRanges(document, 'text_overview_error'),
          ...this.goals.decorationRanges(document, 'background_bad').filter(bad => !admissions.some(a => a.join() === bad.join()))],
        busy: [...busyTypes].flatMap(type => this.goals.decorationRanges(document, type)),
        admissions,
      };
      const groups: Record<LemmaState, DecorationOptions[]> = { checked: [], unfinished: [], error: [] };
      for (const item of this.items(document)) {
        const start = document.positionAt(item.start), end = document.positionAt(item.end);
        const extent: SourceRange = [start.line, start.character, end.line, end.character];
        const state = lemmaState(extent, marks);
        if (!state) continue;
        const inside = (r: SourceRange) => overlaps(extent, r);
        const message = state === 'checked' ? 'Checked: no errors, sorry or oops.'
          : state === 'unfinished' ? `Unfinished: ${marks.admissions.filter(inside).length} sorry or oops.`
          : 'Error: ' + (errors.find(d => inside([d.range.start.line, d.range.start.character, d.range.end.line, d.range.end.character]))
            ?.message.split('\n')[0] ?? 'see the Problems panel.');
        // The hover is on the keyword, such as lemma.
        groups[state].push({ range: new Range(start, document.positionAt(item.start + item.detail.length)),
          hoverMessage: new MarkdownString().appendText(message) });
      }
      const key = JSON.stringify(Object.values(groups).map(group => group.map(option => [option.range.start.line, option.range.end.character])));
      if (this.shown.get(editor) === key) continue;
      for (const state of Object.keys(groups) as LemmaState[]) editor.setDecorations(this.types[state], groups[state]);
      this.shown.set(editor, key);
    }
  }

  // Line and state of each mark in an editor, for the integration checks.
  snapshot(editor: TextEditor): [number, LemmaState][] {
    const key = this.shown.get(editor);
    if (!key) return [];
    const groups = JSON.parse(key) as [number, number][][];
    return (['checked', 'unfinished', 'error'] as LemmaState[]).flatMap((state, index) =>
      groups[index].map(([line]) => [line, state] as [number, LemmaState])).sort((a, b) => a[0] - b[0]);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.subscriptions.forEach(subscription => subscription.dispose());
    Object.values(this.types).forEach(type => type.dispose());
  }
}
