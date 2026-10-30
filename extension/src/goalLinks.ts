import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { commands, Hover, Position, Range, Uri, window, workspace } from 'vscode';
import { GoalLink } from './goalHtml';
import { encodeSymbols, unicodeSymbols } from './symbols';

// Isabelle adds a tooltip for each markup at a position, so the variable of a bounded
// quantifier (∀i < n. P is ∀i. i < n ⟶ P) comes back twice. Show each once.
export function distinctHover(hover: Hover | null | undefined): Hover | null | undefined {
  if (!hover) return hover;
  const seen = new Set<string>();
  const contents = hover.contents.filter(content => {
    const text = typeof content === 'string' ? content : content.value;
    return !seen.has(text) && !!seen.add(text);
  });
  return contents.length === hover.contents.length ? hover : new Hover(contents, hover.range);
}
export function hoverText(hovers: Hover[]): string {
  return hovers.flatMap(hover=>hover.contents.map(content=>typeof content==='string'?content:content.value))
    .map(text=>unicodeSymbols(text.replace(/```[^\n]*\n/g,'').replace(/```/g,''))).join('\n\n').trim();
}
export class GoalLinks {
  constructor(private libraryRoots: string[]) {}
  async target(link: GoalLink) {
    const file=await realpath(link.file);
    const roots=await Promise.allSettled([...this.libraryRoots,
      ...(workspace.workspaceFolders ?? []).map(folder=>folder.uri.fsPath)].map(root=>realpath(root)));
    if(!roots.some(root=>{
      if(root.status!=='fulfilled') return false;
      const part=relative(root.value,file);
      return part!=='..' && !part.startsWith('..'+sep) && !isAbsolute(part);
    })) throw new Error('Goal link is outside this workspace and the Isabelle libraries.');
    const document=await workspace.openTextDocument(Uri.file(file));
    if(!Number.isInteger(link.line) || link.line<0 || link.line>=document.lineCount) throw new Error('Invalid definition line.');
    const line=document.lineAt(link.line).text;
    // HTML supplies a one-based line, not a column. Locate the visible entity
    // on that line if unique; otherwise reveal the line without inventing a range.
    const label=encodeSymbols(link.label), index=label?line.indexOf(label):-1;
    const unique=index>=0 && line.indexOf(label,index+label.length)<0;
    const start=unique?index:line.length-line.trimStart().length;
    const range=new Range(link.line,start,link.line,unique?index+label.length:start);
    return { document,range };
  }
  async open(link: GoalLink): Promise<void> {
    const {document,range}=await this.target(link);
    await window.showTextDocument(document,{selection:range,preview:true});
  }
  async hover(link: GoalLink): Promise<string> {
    const {document,range}=await this.target(link);
    // didOpen precedes the first request, but parsing library source may lag.
    for(let attempt=0;attempt<12;attempt++) {
      const hovers=await commands.executeCommand<Hover[]>('vscode.executeHoverProvider',document.uri,new Position(range.start.line,range.start.character));
      const text=hoverText(hovers ?? []);
      if(text) return text;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    return '';
  }
}
