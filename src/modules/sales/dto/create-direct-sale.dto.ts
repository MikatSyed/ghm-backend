import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsString, ValidateNested } from 'class-validator';
import { SaleItemDto } from './create-sale.dto';

export class CreateDirectSaleDto {
  @ApiProperty({ example: 'CUS-001' })
  @IsString()
  customerId!: string;

  @ApiProperty({ example: '2026-04-18' })
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [SaleItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemDto)
  items!: SaleItemDto[];
}
