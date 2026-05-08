import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SearchQueryDto } from './dto/search.query';
import { SearchService } from './search.service';

@ApiTags('search')
@ApiBearerAuth()
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly service: SearchService) {}

  @Get()
  @ApiOperation({ summary: 'Cross-entity search' })
  search(@Query() q: SearchQueryDto) {
    return this.service.search(q);
  }
}
