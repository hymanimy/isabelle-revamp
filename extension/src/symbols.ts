import codes from './symbolCodes.json';

// Default Unicode assignments from Isabelle2025-2/etc/symbols.
// See THIRD_PARTY_NOTICES.md. Unknown/custom symbols remain readable verbatim.
const symbols: Readonly<Record<string, string>> = codes;
const superscripts: Readonly<Record<string, string>> = Object.fromEntries(
  [...'0123456789+-=()in'].map((char, i) => [char, [...'⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁱⁿ'][i]]));
const subscripts: Readonly<Record<string, string>> = Object.fromEntries(
  [...'0123456789+-=()aehijklmnoprstuvx'].map((char, i) => [char, [...'₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ'][i]]));

export function unicodeSymbols(text: string): string {
  return text.replace(/\\<(\^?[A-Za-z][A-Za-z0-9_]*)>/g,
    (encoded, name: string) => Object.hasOwn(symbols, name) ? symbols[name] : encoded)
    // Isabelle's decoded single-character formatting controls. Keep controls
    // with no Unicode equivalent instead of silently changing their meaning.
    .replace(/[⇧⇩](.)/gu, (encoded, char: string) =>
      (encoded[0] === '⇧' ? superscripts : subscripts)[char] ?? encoded);
}
