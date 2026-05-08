import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsDateString, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class DistributionLineDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  allocated!: number;
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
