import { Injectable } from '@nestjs/common';

export interface StageInput {
  taxPercent?: number;
  profitPercent?: number;
  othersPercent?: number;
  /** Direct price for this tier — overrides the percentage inputs when set. */
  price?: number;
}

export interface StageResult {
  price: number;
  taxPercent: number;
  profitPercent: number;
  othersPercent: number;
}

export interface LadderResult {
  basePrice: number;
  listPrice: number;
  tradePrice: number;
  mrp: number;
  listTaxPercent: number;
  listProfitPercent: number;
  listOthersPercent: number;
  tradeTaxPercent: number;
  tradeProfitPercent: number;
  tradeOthersPercent: number;
  mrpTaxPercent: number;
  mrpProfitPercent: number;
  mrpOthersPercent: number;
}

/**
 * Pricing ladder: Base Price -> List Price -> Trade Price -> MRP.
 * Each stage: next = prev * (1 + tax% + profit% + others%), rounded to the
 * nearest integer BDT. A stage may instead be given a direct price, which
 * back-solves an effective profitPercent for record-keeping (tax/others left
 * at whatever was passed, defaulting to 0) — mirrors how PurchaseLine already
 * lets sellPrice override profitPercent today.
 */
@Injectable()
export class PricingService {
  computeStage(prevPrice: number, input: StageInput): StageResult {
    const taxPercent = input.taxPercent ?? 0;
    const profitPercent = input.profitPercent ?? 0;
    const othersPercent = input.othersPercent ?? 0;

    if (input.price !== undefined) {
      const price = input.price;
      if (prevPrice > 0) {
        const impliedPercent = Math.round(((price - prevPrice) / prevPrice) * 100);
        const explicitPercent = taxPercent + othersPercent;
        return {
          price,
          taxPercent,
          profitPercent: impliedPercent - explicitPercent,
          othersPercent,
        };
      }
      return { price, taxPercent, profitPercent, othersPercent };
    }

    const price = Math.round(prevPrice * (1 + (taxPercent + profitPercent + othersPercent) / 100));
    return { price, taxPercent, profitPercent, othersPercent };
  }

  computeLadder(
    basePrice: number,
    list: StageInput,
    trade: StageInput,
    mrp: StageInput,
  ): LadderResult {
    const listResult = this.computeStage(basePrice, list);
    const tradeResult = this.computeStage(listResult.price, trade);
    const mrpResult = this.computeStage(tradeResult.price, mrp);

    return {
      basePrice,
      listPrice: listResult.price,
      tradePrice: tradeResult.price,
      mrp: mrpResult.price,
      listTaxPercent: listResult.taxPercent,
      listProfitPercent: listResult.profitPercent,
      listOthersPercent: listResult.othersPercent,
      tradeTaxPercent: tradeResult.taxPercent,
      tradeProfitPercent: tradeResult.profitPercent,
      tradeOthersPercent: tradeResult.othersPercent,
      mrpTaxPercent: mrpResult.taxPercent,
      mrpProfitPercent: mrpResult.profitPercent,
      mrpOthersPercent: mrpResult.othersPercent,
    };
  }
}
