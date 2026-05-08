import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBankAccountDto {
  @ApiProperty({ example: 'Dutch Bangla Bank' })
  @IsString()
  @MaxLength(100)
  bankName!: string;

  @ApiProperty({ example: '1234567890' })
  @IsString()
  @MaxLength(50)
  accountNumber!: string;

  @ApiPropertyOptional({ example: 'Green Harvest Mark' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  accountHolder?: string;
}
