// Bengali for the admin panel. To add text: put the exact English on screen as the key in the matching file in
// i18n-bn/. Sentences that contain a value go in the *PatternsBn object, with {placeholders} for the values.
import {extrasBn, extrasPatternsBn} from './i18n-bn/extras';
import {inventoryBn, inventoryPatternsBn} from './i18n-bn/inventory';
import {productsBn, productsPatternsBn} from './i18n-bn/products';
import {shellBn, shellPatternsBn} from './i18n-bn/shell';

export const adminBn: Record<string, string> = {...shellBn, ...inventoryBn, ...productsBn, ...extrasBn};
export const adminPatternsBn: Record<string, string> = {...shellPatternsBn, ...inventoryPatternsBn, ...productsPatternsBn, ...extrasPatternsBn};
