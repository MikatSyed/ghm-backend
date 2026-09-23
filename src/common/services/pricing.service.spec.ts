import * as assert from 'node:assert/strict';
import { PricingService } from './pricing.service';

describe('PricingService.computeStage', () => {
  it('applies additive tax+profit+others percentages on the previous price', () => {
    const svc = new PricingService();
    const result = svc.computeStage(100, { taxPercent: 5, profitPercent: 10, othersPercent: 2 });
    assert.equal(result.price, 117); // 100 * 1.17
    assert.equal(result.taxPercent, 5);
    assert.equal(result.profitPercent, 10);
    assert.equal(result.othersPercent, 2);
  });

  it('rounds to the nearest integer BDT', () => {
    const svc = new PricingService();
    const result = svc.computeStage(117, { taxPercent: 5, profitPercent: 15, othersPercent: 0 });
    assert.equal(result.price, Math.round(117 * 1.2)); // 140
  });

  it('defaults missing percentages to 0', () => {
    const svc = new PricingService();
    const result = svc.computeStage(100, {});
    assert.equal(result.price, 100);
  });

  it('accepts a direct price override and back-solves the effective profit percent', () => {
    const svc = new PricingService();
    const result = svc.computeStage(100, { taxPercent: 5, price: 120 });
    assert.equal(result.price, 120);
    assert.equal(result.taxPercent, 5);
    assert.equal(result.profitPercent, 15); // 20% implied - 5% explicit tax
  });
});

describe('PricingService.computeLadder', () => {
  it('chains Base -> List -> Trade -> MRP', () => {
    const svc = new PricingService();
    const ladder = svc.computeLadder(
      100,
      { taxPercent: 5, profitPercent: 10, othersPercent: 2 },
      { taxPercent: 5, profitPercent: 15, othersPercent: 0 },
      { taxPercent: 0, profitPercent: 10, othersPercent: 0 },
    );
    assert.equal(ladder.basePrice, 100);
    assert.equal(ladder.listPrice, 117);
    assert.equal(ladder.tradePrice, 140); // round(117 * 1.2)
    assert.equal(ladder.mrp, 154); // round(140 * 1.1)
  });

  it('allows a direct trade price override mid-ladder while list/mrp still cascade', () => {
    const svc = new PricingService();
    const ladder = svc.computeLadder(
      100,
      { taxPercent: 0, profitPercent: 10, othersPercent: 0 },
      { price: 150 },
      { taxPercent: 0, profitPercent: 10, othersPercent: 0 },
    );
    assert.equal(ladder.listPrice, 110);
    assert.equal(ladder.tradePrice, 150);
    assert.equal(ladder.mrp, 165); // round(150 * 1.1)
  });
});
