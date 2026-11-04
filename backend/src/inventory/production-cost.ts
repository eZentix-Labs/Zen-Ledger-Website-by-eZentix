export type ProductionCostSettlementInput = {
  totalCostPaise: number;
  plannedQty: number;
  producedQty: number;
  acceptedQty: number;
  previouslyAllocatedPaise?: number;
  closed: boolean;
};

/** Allocate planned-share cost to accepted output; a completed short order leaves the balance as variance. */
export function settleProductionCost(input: ProductionCostSettlementInput) {
  const {totalCostPaise, plannedQty, producedQty, acceptedQty, closed} = input;
  const previouslyAllocatedPaise = input.previouslyAllocatedPaise ?? 0;
  if (![totalCostPaise, plannedQty, producedQty, acceptedQty, previouslyAllocatedPaise].every(Number.isSafeInteger)
    || totalCostPaise < 0 || plannedQty <= 0 || producedQty < 0 || acceptedQty < 0
    || previouslyAllocatedPaise < 0 || acceptedQty > producedQty || producedQty > plannedQty) {
    throw new RangeError('Invalid production cost settlement inputs');
  }

  // A full planned run absorbs all issued cost in accepted output, including rejected-unit cost.
  // A short run absorbs only its planned share; the remainder is booked as production variance.
  const targetAllocatedPaise = acceptedQty === 0
    ? 0
    : producedQty === plannedQty
      ? totalCostPaise
      : Math.round(totalCostPaise * producedQty / plannedQty);
  if (previouslyAllocatedPaise > targetAllocatedPaise) throw new RangeError('Allocated production cost exceeds the settlement target');
  const variancePaise = closed ? totalCostPaise - targetAllocatedPaise : 0;
  return {
    targetAllocatedPaise,
    additionalAllocatedPaise: targetAllocatedPaise - previouslyAllocatedPaise,
    variancePaise,
  };
}
