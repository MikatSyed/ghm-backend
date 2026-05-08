import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BankTransactionType } from '@prisma/client';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateBankTransactionDto {
  @ApiProperty({ enum: BankTransactionType })
  @IsEnum(BankTransactionType)
  type!: BankTransactionType;

  @ApiProperty({ minimum: 1, description: 'Amount in BDT' })
  @IsInt()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @ApiPropertyOptional({ description: 'Cheque number or transfer reference' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiProperty({ example: '2026-05-03T10:00:00Z' })
  @IsDateString()
  occurredAt!: string;
}
