import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class DistributionLineDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  allocated!: number;

  @ApiPropertyOptional({
    example: 'BAT-007',
    description: 'Restrict FIFO allocation to this batch',
  })
  @IsOptional()
  @IsString()
  batchId?: string;

  @ApiPropertyOptional({
    example: 'STK-011',
    description: 'Restrict allocation to this exact stock lot',
  })
  @IsOptional()
  @IsString()
  stockEntryId?: string;
}

export class CreateDistributionDto {
  @ApiProperty({ example: 'V1' })
  @IsString()
  vanId!: string;

  @ApiProperty({ example: '2026-04-18' })
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [DistributionLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DistributionLineDto)
  lines!: DistributionLineDto[];
}
