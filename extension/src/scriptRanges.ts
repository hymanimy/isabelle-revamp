import { decodeSymbols } from './symbols';
export interface ScriptGroup { controls: [number,number][]; content: [number,number]; style: 'sup'|'sub'|'bold' }
export function scriptRanges(source: string): ScriptGroup[] {
  const tokens = [...source.matchAll(/\\<[^>\n]+>|[\s\S]/gu)].map(match =>
    ({ start:match.index,end:match.index+match[0].length,text:decodeSymbols(match[0]) }));
  const control = Object.fromEntries(['sub','sup','bold','bsub','esub','bsup','esup']
    .map(name=>[name,decodeSymbols('\\<^'+name+'>')]));
  const groups: ScriptGroup[] = [];
  const stack: { index:number; style:'sup'|'sub'; close:string }[] = [];
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i], next=tokens[i+1];
    const style = token.text===control.sup ? 'sup' : token.text===control.sub ? 'sub' : token.text===control.bold ? 'bold' : undefined;
    if (style && next && !/\s/u.test(next.text) && !Object.values(control).includes(next.text)) {
      groups.push({controls:[[token.start,token.end]],content:[next.start,next.end],style});
    } else if(token.text===control.bsup || token.text===control.bsub) {
      stack.push({index:i,style:token.text===control.bsup?'sup':'sub',close:token.text===control.bsup?control.esup:control.esub});
    } else if(token.text===stack.at(-1)?.close) {
      const open=stack.pop()!;
      if (i>open.index+1) groups.push({controls:[[tokens[open.index].start,tokens[open.index].end],[token.start,token.end]],
        content:[tokens[open.index].end,token.start],style:open.style});
    }
  }
  return groups;
}
