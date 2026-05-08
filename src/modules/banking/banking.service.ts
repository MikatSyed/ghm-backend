import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
import { CreateBankTransactionDto } from './dto/create-bank-transaction.dto';

@Injectable()
export class BankingService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Bank Accounts ──────────────────────────────────────────────────────────

  async createAccount(dto: CreateBankAccountDto) {
    return this.prisma.bankAccount.create({ data: dto });
  }

  async listAccounts() {
    return this.prisma.bankAccount.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findAccount(id: string) {
    const acc = await this.prisma.bankAccount.findFirst({
      where: { id, deletedAt: null },
      include: {
        transactions: {
          orderBy: { occurredAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!acc) throw new NotFoundException({ code: 'NOT_FOUND', message: `Bank account ${id} not found` });
    return acc;
  }

  async updateAccount(id: string, dto: Partial<CreateBankAccountDto>) {
    await this.findAccount(id);
    return this.prisma.bankAccount.update({ where: { id }, data: dto });
  }

  async removeAccount(id: string) {
    await this.findAccount(id);
    // Check no transactions
    const txCount = await this.prisma.bankTransaction.count({ where: { bankAccountId: id } });
    if (txCount > 0) {
      throw new BadRequestException({
        code: 'IN_USE',
        message: 'Bank account has transactions and cannot be deleted',
        fields: { transactions: txCount },
      });
    }
    await this.prisma.bankAccount.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  // ── Transactions ───────────────────────────────────────────────────────────

  async createTransaction(accountId: string, dto: CreateBankTransactionDto) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: accountId, deletedAt: null },
    });
    if (!account) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: `Bank account ${accountId} not found` });
    }

    if (dto.type === 'withdrawal' && account.balance < dto.amount) {
      throw new BadRequestException({
        code: 'INSUFFICIENT_BALANCE',
        message: `Insufficient balance. Current: ৳${account.balance}, Requested: ৳${dto.amount}`,
        fields: { balance: account.balance, requested: dto.amount },
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.bankTransaction.create({
        data: {
          bankAccountId: accountId,
          type: dto.type,
          amount: dto.amount,
          description: dto.description,
          reference: dto.reference,
          occurredAt: new Date(dto.occurredAt),
        },
      });

      // Update balance
      await tx.bankAccount.update({
        where: { id: accountId },
        data: {
          balance:
            dto.type === 'deposit'
              ? { increment: dto.amount }
              : { decrement: dto.amount },
        },
      });

      return transaction;
    });
  }

  async listTransactions(
    accountId: string,
    query: { dateFrom?: string; dateTo?: string; type?: string; page?: number; limit?: number },
  ) {
    const where: Prisma.BankTransactionWhereInput = {
      bankAccountId: accountId,
      ...(query.type ? { type: query.type as any } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            occurredAt: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async deleteTransaction(accountId: string, transactionId: string) {
    const tx = await this.prisma.bankTransaction.findFirst({
      where: { id: transactionId, bankAccountId: accountId },
    });
    if (!tx) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Transaction not found' });

    // Reverse the balance effect
    await this.prisma.$transaction(async (prisma) => {
      await prisma.bankTransaction.delete({ where: { id: transactionId } });
      await prisma.bankAccount.update({
        where: { id: accountId },
        data: {
          balance:
            tx.type === 'deposit'
              ? { decrement: tx.amount }
              : { increment: tx.amount },
        },
      });
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  async getSummary() {
    const accounts = await this.prisma.bankAccount.findMany({
      where: { deletedAt: null },
      select: { id: true, bankName: true, accountNumber: true, accountHolder: true, balance: true, isActive: true },
    });

    const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

    // Recent transactions across all accounts
    const recentTransactions = await this.prisma.bankTransaction.findMany({
      orderBy: { occurredAt: 'desc' },
      take: 10,
      include: {
        bankAccount: { select: { bankName: true, accountNumber: true } },
      },
    });

    return { accounts, totalBalance, recentTransactions };
  }
}
