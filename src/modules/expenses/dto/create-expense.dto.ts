import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { EXPENSE_CATEGORIES, ExpenseCategory } from '../expense-categories';

export class CreateExpenseDto {
  @ApiProperty({ example: '2026-04-18' })
  @IsDateString()
  date!: string;

  @ApiProperty({ enum: EXPENSE_CATEGORIES })
  @IsIn(EXPENSE_CATEGORIES as unknown as string[])
  category!: ExpenseCategory;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  amount!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(300)
  description!: string;

  @ApiPropertyOptional({ enum: ExpenseStatus, default: ExpenseStatus.pending })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional({ example: 'V1' })
  @IsOptional()
  @IsString()
  vanId?: string;
}
