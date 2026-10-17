import { decodeEntities, escapeText } from './outputText';
import { decodeSymbols, unicodeSymbols } from './symbols';
import { fileURLToPath } from 'node:url';
import { scriptRanges } from './scriptRanges';
export interface GoalLink { file: string; line: number; label: string }
interface Element { tag: string; classes: string[]; children: Node[]; target?: Omit<GoalLink, 'label'> }
interface Text { text: string; start: number }
type Node = Element | Text;
const allowed = new Set(['span','a','pre','br']);
const discarded = new Set(['script','style','iframe','object','embed','svg','math','template']);

// Reconstruct a tiny HTML subset. No source tag/attribute string reaches HTML.
export function goalMarkup(source: string): { html: string; links: GoalLink[] } {
  const links: GoalLink[] = [];
  const root: Element = {tag:'',classes:[],children:[]}, stack=[root];
  let skip: string|undefined, skipDepth=0, text='';
  const tokens = source.match(/<!--[\s\S]*?(?:-->|$)|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('<!--')) continue;
    const tag=/^<\s*(\/?)\s*([a-z][a-z0-9]*)\b([\s\S]*?)>$/i.exec(token);
    if (tag) {
      const closing=!!tag[1], name=tag[2].toLowerCase();
      if (skip) { if(name===skip) { skipDepth += closing ? -1 : 1; if(!skipDepth) skip=undefined; } continue; }
      if (discarded.has(name)) { if(!closing && !/\/\s*>$/.test(token)) { skip=name;skipDepth=1; } continue; }
      if (!allowed.has(name)) continue;
      if (closing) { const index=stack.map(node=>node.tag).lastIndexOf(name);if(index>0) stack.length=index;continue; }
      const attributes=[...tag[3].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)];
      const classes=(attributes.find(attr=>attr[1].toLowerCase()==='class')?.slice(2).find(value=>value!==undefined) ?? '')
        .split(/\s+/).filter(value=>/^[A-Za-z_][\w-]*$/.test(value)
          && value !== 'isabelle-entity' && !value.startsWith('isabelle-link-'));
      const element: Element={tag:name,classes,children:[]};stack.at(-1)!.children.push(element);
      if(name==='a') {
        const href=attributes.find(attr=>attr[1].toLowerCase()==='href')?.slice(2).find(value=>value!==undefined);
        if(href) try {
          const url=new URL(decodeEntities(href));
          if(url.protocol==='file:' && !url.host && !url.search && /^#[1-9][0-9]*$/.test(url.hash)) {
            const line=Number(url.hash.slice(1))-1;
            if(Number.isSafeInteger(line)) element.target={file:fileURLToPath(url),line};
          }
        } catch { /* Non-local or malformed links remain inert. */ }
      }
      if(name==='br') { text+='\n'; }
      else if(!/\/\s*>$/.test(token)) stack.push(element);
    } else if(!skip) {
      const decoded=decodeSymbols(decodeEntities(token));
      stack.at(-1)!.children.push({text:decoded,start:text.length});text+=decoded;
    }
  }
  const groups=scriptRanges(text), hidden=groups.flatMap(group=>group.controls);
  const render=(node: Node): string => {
    if ('text' in node) {
      let result='', offset=node.start;
      for (const char of node.text) {
        const at=offset;offset+=char.length;
        if(hidden.some(([a,b])=>at>=a && at<b)) continue;
        const styles=groups.filter(group=>at>=group.content[0] && at<group.content[1]).map(group=>'isabelle-script-'+group.style);
        result+=styles.length ? `<span class="${styles.join(' ')}">${escapeText(char)}</span>` : escapeText(char);
      }
      return result;
    }
    const contents=node.children.map(render).join('');
    if(!node.tag) return contents;
    if(node.target) {
      const label=(item: Node): string => 'text' in item ? item.text : item.children.map(label).join('');
      const id=links.length;links.push({...node.target,label:unicodeSymbols(label(node))});
      node.classes.push('isabelle-entity','isabelle-link-'+id);
    }
    const classes=node.classes.length ? ` class="${node.classes.join(' ')}"` : '';
    return `<${node.tag}${classes}>`+(node.tag==='br'?'':contents+`</${node.tag}>`);
  };
  const html=render(root);
  return {html,links};
}

export const goalHtml = (source: string): string => goalMarkup(source).html;
