import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ShipmentPurchaseItemDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productId: string;

  @ApiProperty()
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  basePrice: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  sellPrice?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  profitPercent?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateShipmentDto {
  @ApiProperty({ example: '2024-05-08' })
  @IsDateString()
  date: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  transportCost: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  labourCost: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  otherCost?: number;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  source: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bankAccountId?: string;

  @ApiProperty({ type: [ShipmentPurchaseItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShipmentPurchaseItemDto)
  items: ShipmentPurchaseItemDto[];
}
