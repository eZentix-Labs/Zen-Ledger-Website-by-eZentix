import {describe,expect,it} from 'vitest';
import {createTranslator} from './i18n-translate.js';
const translate=createTranslator({Pending:'অপেক্ষমাণ','Partially received':'আংশিক প্রাপ্ত','Item':'আইটেম','Item no.':'আইটেম নং','No returns':'ফেরত নেই','almirah(s)':'টি আলমারি','{0} days':'{0} দিন','Order {0} is late':'অর্ডার {0} দেরি','{0} payment{1} due':'{0} পেমেন্ট বাকি'});
describe('Bengali text translation',()=>{
  it('matches exact, enum and upper-case text',()=>{expect(translate('Pending')).toBe('অপেক্ষমাণ');expect(translate('PENDING')).toBe('অপেক্ষমাণ');expect(translate('PARTIALLY_RECEIVED')).toBe('আংশিক প্রাপ্ত');});
  it('keeps surrounding spaces and punctuation',()=>{expect(translate(' Pending ')).toBe(' অপেক্ষমাণ ');expect(translate('· Item:')).toBe('· আইটেম:');expect(translate('Item no. *')).toBe('আইটেম নং *');expect(translate('almirah(s).')).toBe('টি আলমারি।');expect(translate('No returns.')).toBe('ফেরত নেই।');});
  it('fills placeholders and allows empty ones',()=>{expect(translate('Order 42 is late')).toBe('অর্ডার 42 দেরি');expect(translate('3 payment due')).toBe('3 পেমেন্ট বাকি');});
  it('translates each part of compound text and leaves unknown parts',()=>{expect(translate('Rahul · 3 days · Pending')).toBe('Rahul · 3 দিন · অপেক্ষমাণ');expect(translate('12 Pending')).toBe('12 অপেক্ষমাণ');expect(translate('No returns. Pending')).toBe('ফেরত নেই। অপেক্ষমাণ');});
  it('translates dates, including upper-case ones',()=>{expect(translate('4 Nov 2026')).toBe('4 নভে 2026');expect(translate('WEDNESDAY, 4 NOVEMBER 2026')).toBe('বুধবার, 4 নভেম্বর 2026');});
  it('leaves data it does not know alone',()=>{expect(translate('Steel Almari 6.5 ft')).toBeUndefined();expect(translate('12,500')).toBeUndefined();});
});
