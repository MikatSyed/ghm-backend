import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class SaleItemDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  price!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  qty!: number;
}

export class CreateSaleDto {
  @ApiProperty({ example: 'V1' })
  @IsString()
  vanId!: string;

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
