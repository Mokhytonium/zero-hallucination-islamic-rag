const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u08F0-\u08FF]/g;

export function stripDiacritics(text: string): string {
  return text.replace(DIACRITICS, "");
}

export function displayArabic(text: string, diacritics: boolean): string {
  return diacritics ? text : stripDiacritics(text);
}