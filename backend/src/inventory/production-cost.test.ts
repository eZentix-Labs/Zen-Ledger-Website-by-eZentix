import {describe, expect, it} from 'vitest';
import {settleProductionCost} from './production-cost.js';

const totalCostPaise = 2_720_000; // ₹27,200

describe('production cost settlement', () => {
  it('allocates all cost when all 10 planned units are accepted', () => {
    const s = settleProductionCost({totalCostPaise, plannedQty: 10, producedQty: 10, acceptedQty: 10, closed: true});
    expect(s).toMatchObject({targetAllocatedPaise: 2_720_000, additionalAllocatedPaise: 2_720_000, variancePaise: 0});
    expect(s.targetAllocatedPaise + s.variancePaise).toBe(totalCostPaise);
  });

  it('absorbs one rejected unit across the nine accepted units', () => {
    const s = settleProductionCost({totalCostPaise, plannedQty: 10, producedQty: 10, acceptedQty: 9, closed: true});
    expect(s).toMatchObject({targetAllocatedPaise: 2_720_000, variancePaise: 0});
    expect(Math.round(s.targetAllocatedPaise / 9)).toBe(302_222); // ₹3,022.22 per accepted unit
    expect(s.targetAllocatedPaise + s.variancePaise).toBe(totalCostPaise);
  });

  it('posts the unabsorbed half as variance when closed short at five of ten', () => {
    const s = settleProductionCost({totalCostPaise, plannedQty: 10, producedQty: 5, acceptedQty: 5, closed: true});
    expect(s).toMatchObject({targetAllocatedPaise: 1_360_000, variancePaise: 1_360_000});
    expect(s.targetAllocatedPaise + s.variancePaise).toBe(totalCostPaise);
  });

  it('books all cost as variance when no unit is accepted', () => {
    const s = settleProductionCost({totalCostPaise, plannedQty: 10, producedQty: 10, acceptedQty: 0, closed: true});
    expect(s).toMatchObject({targetAllocatedPaise: 0, variancePaise: totalCostPaise});
    expect(s.targetAllocatedPaise + s.variancePaise).toBe(totalCostPaise);
  });
});
