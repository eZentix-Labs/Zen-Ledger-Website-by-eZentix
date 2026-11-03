import React, {useCallback, useMemo} from 'react';
import {useLanguage} from '../i18n.js';

type Vars = Record<string, React.ReactNode>;
/**
 * Translation helpers on top of the app's dictionary-based `t()`. Keys are the English text,
 * placeholders look like `{name}`:
 *  - s(key, vars)  → string (vars are stringified)
 *  - f(key, vars)  → ReactNode[] so numbers can be wrapped in <b> / chips inside a translated sentence
 */
export function useI() {
  const {t, language} = useLanguage();
  const s = useCallback((key: string, vars: Record<string, string | number> = {}) => t(key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')), [t]);
  const f = useCallback((key: string, vars: Vars) => t(key).split(/(\{\w+\})/).map((part, i) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m ? <React.Fragment key={i}>{vars[m[1]]}</React.Fragment> : part;
  }), [t]);
  return useMemo(() => ({t, s, f, language}), [t, s, f, language]);
}
