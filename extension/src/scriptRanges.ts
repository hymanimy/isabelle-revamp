import { decodeSymbols } from './symbols';
export interface ScriptGroup { controls: [number,number][]; content: [number,number]; style: 'sup'|'sub'|'bold' }
type Control = 'sub'|'sup'|'bold'|'bsub'|'esub'|'bsup'|'esup';
const names: Control[] = ['sub','sup','bold','bsub','esub','bsup','esup'];
// Visit only symbols and decoded control characters; tokenizing every character is too slow for large theories.
export function scriptRanges(source: string): ScriptGroup[] {
  const control = new Map<string,Control>();
  for (const name of names) { control.set('\\<^'+name+'>',name); control.set(decodeSymbols('\\<^'+name+'>'),name); }
  const glyphs = [...control.keys()].filter(key=>!key.startsWith('\\<')).map(key=>key.replace(/[\\^$.*+?()[\]{}|-]/g,'\\$&'));
  const pattern = new RegExp('\\\\<[^>\\n]+>' + (glyphs.length ? '|' + glyphs.join('|') : ''), 'gu');
  const next = /\\<[^>\n]+>|[\s\S]/uy;
  const groups: ScriptGroup[] = [];
  const stack: { start:number; end:number; style:'sup'|'sub'; close:Control }[] = [];
  for (const match of source.matchAll(pattern)) {
    const name = control.get(match[0]);
    if (!name) continue;
    const start = match.index, end = start + match[0].length;
    if (name==='sup' || name==='sub' || name==='bold') {
      next.lastIndex = end;
      const token = next.exec(source)?.[0];
      if (token && !/\s/u.test(token) && !control.has(decodeSymbols(token)) && !control.has(token)) {
        groups.push({controls:[[start,end]],content:[end,end+token.length],style:name});
      }
    } else if (name==='bsup' || name==='bsub') {
      stack.push({start,end,style:name==='bsup'?'sup':'sub',close:name==='bsup'?'esup':'esub'});
    } else if (name===stack.at(-1)?.close) {
      const open=stack.pop()!;
      if (start>open.end) groups.push({controls:[[open.start,open.end],[start,end]],content:[open.end,start],style:open.style});
    }
  }
  return groups;
}
