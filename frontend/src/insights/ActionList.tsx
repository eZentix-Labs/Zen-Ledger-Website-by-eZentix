import {memo, useMemo} from 'react';
import {rupees} from '../inventory/api';
import {useToast} from '../inventory/ui';
import {actionsFor} from './derive';
import type {GoTab, Insights} from './types';
import {useI} from './useI';

/** "3 things to do this week": plain-language to-dos built from the same payload. */
export const ActionList = memo(function ActionList({d, go}: {d: Insights; go: (tab: GoTab) => void}) {
  const {t, s} = useI();
  const toast = useToast();
  const items = useMemo(() => actionsFor(d, rupees), [d]);
  return <section className="ins-card" aria-labelledby="ins-act-h">
    <header className="ins-card-head"><h3 id="ins-act-h">{t('3 things to do this week')}</h3></header>
    {items.length ? <ol className="ins-actions">
      {items.map((a, i) => <li key={a.key}>
        <span className="ins-step" aria-hidden="true">{i + 1}</span>
        <div className="grow"><b>{s(a.title, a.titleVars)}</b><small>{s(a.hint, a.hintVars)}</small></div>
        {a.button && <button type="button" className="ins-ghost" onClick={() => { go(a.button!.tab); toast('ok', s('Opened: {page}', {page: t(a.button!.label)})); }}>{t(a.button.label)}</button>}
      </li>)}
    </ol> : <div className="ins-empty"><p>{t('Nothing urgent. Keep going!')}</p></div>}
  </section>;
});
