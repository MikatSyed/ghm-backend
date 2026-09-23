import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsString, Min, ValidateNested } from 'class-validator';

export class ConfirmDistributionOrderLineDto {
  @ApiProperty({ example: 'PRD-001' })
  @IsString()
  productId!: string;

  @ApiProperty({ minimum: 0, description: 'Delivered quantity; clamped to the requested quantity' })
  @IsInt()
  @Min(0)
  confirmedQty!: number;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  price!: number;
}

export class ConfirmDistributionOrderDto {
  @ApiProperty({
    type: [ConfirmDistributionOrderLineDto],
    description:
      'Only lines being confirmed need to be listed; omitted lines or confirmedQty:0 are treated as not delivered',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfirmDistributionOrderLineDto)
  lines!: ConfirmDistributionOrderLineDto[];
}
