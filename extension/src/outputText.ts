import { unicodeSymbols } from './symbols';

// Isabelle's HTML.source emits inline tags, XML entities, and literal Unicode.
// Plain-text path for MCP and diagnostics. Rich sidebar output has a separate sanitizer.
export function decodeEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  };
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity, name: string) => {
      if (!name.startsWith('#')) return entities[name.toLowerCase()];
      const code = name[1].toLowerCase() === 'x'
        ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code) : entity;
    });
}

export function outputText(html: string): string {
  return unicodeSymbols(decodeEntities(html.replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, '')));
}

export function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
