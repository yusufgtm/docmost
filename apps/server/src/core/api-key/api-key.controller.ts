import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import {
  CreateApiKeyDto,
  RevokeApiKeyDto,
  UpdateApiKeyDto,
} from './dto/api-key.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';

@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async listApiKeys(@AuthWorkspace() workspace: Workspace) {
    const items = await this.apiKeyService.listApiKeys(workspace.id);
    return { items, meta: { hasPrevPage: false, hasNextPage: false, nextCursor: null } };
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createApiKey(
    @Body() dto: CreateApiKeyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeyService.createApiKey(dto, user, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateApiKey(
    @Body() dto: UpdateApiKeyDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeyService.updateApiKey(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('revoke')
  async revokeApiKey(
    @Body() dto: RevokeApiKeyDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.apiKeyService.revokeApiKey(dto.apiKeyId, workspace.id);
  }
}
