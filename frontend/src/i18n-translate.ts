// Turns the English text the app renders into its dictionary translation. Pure string logic (no DOM)
// so it can be unit tested. Most screens render plain English and rely on this, so it also copes with
// text the dictionary cannot hold word for word: enum values, numbers, dates and "a · b" compounds.
export type Translator = (text: string) => string | undefined;

const MONTHS: Record<string, string> = {
  jan: 'জানু', feb: 'ফেব্রু', mar: 'মার্চ', apr: 'এপ্রিল', may: 'মে', jun: 'জুন', jul: 'জুলাই', aug: 'আগস্ট', sep: 'সেপ্টে', oct: 'অক্টো', nov: 'নভে', dec: 'ডিসে',
  january: 'জানুয়ারি', february: 'ফেব্রুয়ারি', march: 'মার্চ', april: 'এপ্রিল', june: 'জুন', july: 'জুলাই', august: 'আগস্ট', september: 'সেপ্টেম্বর', october: 'অক্টোবর', november: 'নভেম্বর', december: 'ডিসেম্বর',
  monday: 'সোমবার', tuesday: 'মঙ্গলবার', wednesday: 'বুধবার', thursday: 'বৃহস্পতিবার', friday: 'শুক্রবার', saturday: 'শনিবার', sunday: 'রবিবার',
  mon: 'সোম', tue: 'মঙ্গল', wed: 'বুধ', thu: 'বৃহস্পতি', fri: 'শুক্র', sat: 'শনি', sun: 'রবি', am: 'পূর্বাহ্ণ', pm: 'অপরাহ্ণ',
};
const DATE_WORD = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
const DATE_ONLY = new RegExp(`^[\\d\\s,/:.\\-–]*(?:(?:${DATE_WORD})\\b[\\d\\s,/:.\\-–]*)+$`, 'i');
const DATE_TOKEN = new RegExp(`\\b(${DATE_WORD})\\b`, 'gi');
const LEADING = /^[\s·•—–:;,)+*]+/;
const TRAILING = /[\s·•—–:;,(*…]+$/;
const SEPARATOR = /( · | — | → |(?<=\.) )/;
const NUMBER_FIRST = /^([₹\d][\d,.]*%?)(\s+)(.+)$/;
const NUMBER_LAST = /^(.*\S)(\s*[(:]\s*[₹\d][\d,.]*%?\)?|\s+[₹\d][\d,.]*%?)$/;
const CACHE_LIMIT = 5000;

const normalize = (s: string) => s.toLowerCase().replace(/_/g, ' ');
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Pattern = {regex: RegExp; names: string[]; value: string};

function compilePatterns(dict: Record<string, string>): Pattern[] {
  return Object.keys(dict).filter(key => /\{\w+\}/.test(key) && /[A-Za-z]{2}/.test(key.replace(/\{\w+\}/g, ''))).map(key => {
    const names: string[] = [];
    const source = key.split(/(\{\w+\})/).map(part => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m) return escapeRegExp(part);
      names.push(m[1]);
      return '(.*?)';
    }).join('');
    return {regex: new RegExp(`^${source}$`), names, value: dict[key]};
  }).sort((a, b) => b.regex.source.length - a.regex.source.length);
}

export function createTranslator(dict: Record<string, string>): Translator {
  const byNormalKey = new Map<string, string>();
  for (const key of Object.keys(dict)) if (!byNormalKey.has(normalize(key))) byNormalKey.set(normalize(key), dict[key]);
  const patterns = compilePatterns(dict);
  const cache = new Map<string, string | undefined>();

  function core(text: string, depth: number): string | undefined {
    if (dict[text]) return dict[text];
    const known = byNormalKey.get(normalize(text));
    if (known) return known;
    if (DATE_ONLY.test(text)) return text.replace(DATE_TOKEN, word => MONTHS[word.toLowerCase()]);
    if (depth > 4) return undefined;
    const lead = LEADING.exec(text)?.[0] || '', tail = TRAILING.exec(text)?.[0] || '';
    if ((lead || tail) && lead.length + tail.length < text.length) {
      const inner = core(text.slice(lead.length, text.length - tail.length), depth + 1);
      if (inner) return lead + inner + tail;
    }
    if (text.endsWith('.')) { const sentence = core(text.slice(0, -1), depth + 1); if (sentence) return `${sentence}।`; }
    for (const {regex, names, value} of patterns) {
      const m = regex.exec(text);
      if (!m) continue;
      return names.reduce((out, name, i) => out.split(`{${name}}`).join(core(m[i + 1], depth + 1) ?? m[i + 1]), value);
    }
    const parts = text.split(SEPARATOR);
    if (parts.length > 1) {
      const translated = parts.map((part, i) => i % 2 ? part : core(part, depth + 1));
      if (translated.some(Boolean)) return translated.map((part, i) => part ?? parts[i]).join('');
    }
    const first = NUMBER_FIRST.exec(text);
    if (first) { const rest = core(first[3], depth + 1); if (rest) return first[1] + first[2] + rest; }
    const last = NUMBER_LAST.exec(text);
    if (last) { const rest = core(last[1], depth + 1); if (rest) return rest + last[2]; }
    return undefined;
  }

  return text => {
    if (!/[A-Za-z]/.test(text)) return undefined;
    if (cache.has(text)) return cache.get(text);
    const body = text.trim();
    const inner = body ? core(body, 0) : undefined;
    const result = inner === undefined ? undefined : text.replace(body, () => inner);
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(text, result);
    return result;
  };
}
