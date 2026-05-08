import * as assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const config = { getOrThrow: () => 'test-secret' } as unknown as ConfigService;
  const strategy = new JwtStrategy(config);

  it('maps payload directly to AuthUser without DB hit', async () => {
    const payload = { sub: 'USR-01', email: 'a@b.com', role: 'ADMIN' as const };
    const result = await strategy.validate(payload);
    assert.deepEqual(result, { id: 'USR-01', email: 'a@b.com', role: 'ADMIN' });
  });

  it('preserves STAFF role through mapping', async () => {
    const payload = { sub: 'USR-99', email: 'staff@b.com', role: 'STAFF' as const };
    const result = await strategy.validate(payload);
    assert.deepEqual(result, { id: 'USR-99', email: 'staff@b.com', role: 'STAFF' });
  });

  it('example output', async () => {
    const out = await strategy.validate({ sub: 'USR-01', email: 'admin@ghm.local', role: 'ADMIN' });
    console.log('example validate() output:', out);
    assert.equal(out.id, 'USR-01');
  });
});
