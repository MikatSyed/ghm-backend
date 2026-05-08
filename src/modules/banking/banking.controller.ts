import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankingService } from './banking.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateBankTransactionDto } from './dto/create-bank-transaction.dto';

@ApiTags('banking')
@ApiBearerAuth()
@Controller({ path: 'banking', version: '1' })
export class BankingController {
  constructor(private readonly service: BankingService) {}

  // ── Summary ────────────────────────────────────────────────────────────────

  @Get('summary')
  @ApiOperation({ summary: 'Get total bank balance and recent transactions across all accounts' })
  getSummary() {
    return this.service.getSummary();
  }

  // ── Bank Accounts ──────────────────────────────────────────────────────────

  @Get('accounts')
  @ApiOperation({ summary: 'List all bank accounts' })
  listAccounts() {
    return this.service.listAccounts();
  }

  @Post('accounts')
  @ApiOperation({ summary: 'Add a new bank account' })
  createAccount(@Body() dto: CreateBankAccountDto) {
    return this.service.createAccount(dto);
  }

  @Get('accounts/:id')
  @ApiOperation({ summary: 'Get bank account with recent transactions' })
  findAccount(@Param('id') id: string) {
    return this.service.findAccount(id);
  }

  @Patch('accounts/:id')
  @ApiOperation({ summary: 'Update bank account details' })
  updateAccount(@Param('id') id: string, @Body() dto: Partial<CreateBankAccountDto>) {
    return this.service.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a bank account (only if no transactions)' })
  async removeAccount(@Param('id') id: string): Promise<void> {
    await this.service.removeAccount(id);
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  @Get('accounts/:id/transactions')
  @ApiOperation({ summary: 'List transactions for a bank account' })
  listTransactions(
    @Param('id') id: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('type') type?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.service.listTransactions(id, { dateFrom, dateTo, type, page, limit });
  }

  @Post('accounts/:id/transactions')
  @ApiOperation({ summary: 'Record a deposit or withdrawal' })
  createTransaction(@Param('id') id: string, @Body() dto: CreateBankTransactionDto) {
    return this.service.createTransaction(id, dto);
  }

  @Delete('accounts/:id/transactions/:txId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a transaction and reverse its balance effect' })
  async deleteTransaction(
    @Param('id') id: string,
    @Param('txId') txId: string,
  ): Promise<void> {
    await this.service.deleteTransaction(id, txId);
  }
}
