import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class DistributionOrderLineDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  requestedQty!: number;

  @ApiProperty({ minimum: 0, description: 'Quoted price at order time; can be changed at confirm' })
  @IsInt()
  @Min(0)
  price!: number;
}

export class CreateDistributionOrderDto {
  @ApiProperty({ example: 'CUS-001' })
  @IsString()
  customerId!: string;

  @ApiProperty({ example: '2026-04-18' })
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [DistributionOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DistributionOrderLineDto)
  lines!: DistributionOrderLineDto[];
}
