import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyRepo } from '@docmost/db/repos/api-key/api-key.repo';
import { TokenService } from '../auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtApiKeyPayload } from '../auth/dto/jwt-payload';
import { isUserDisabled } from '../../common/helpers';
import { CreateApiKeyDto, UpdateApiKeyDto } from './dto/api-key.dto';

@Injectable()
export class ApiKeyService {
  constructor(
    private readonly apiKeyRepo: ApiKeyRepo,
    private readonly tokenService: TokenService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
  ) {}

  async createApiKey(
    dto: CreateApiKeyDto,
    user: User,
    workspaceId: string,
  ): Promise<{ apiKey: { id: string; name: string; createdAt: Date }; token: string }> {
    const apiKey = await this.apiKeyRepo.insert({
      name: dto.name ?? 'API Key',
      creatorId: user.id,
      workspaceId,
    });

    const token = await this.tokenService.generateApiToken({
      apiKeyId: apiKey.id,
      user,
      workspaceId,
    });

    return {
      apiKey: { id: apiKey.id, name: apiKey.name, createdAt: apiKey.createdAt },
      token,
    };
  }

  async listApiKeys(workspaceId: string) {
    return this.apiKeyRepo.findByWorkspaceId(workspaceId);
  }

  async updateApiKey(dto: UpdateApiKeyDto, workspaceId: string) {
    const key = await this.apiKeyRepo.findById(dto.apiKeyId, workspaceId);
    if (!key) throw new NotFoundException('API key not found');

    return this.apiKeyRepo.update(key.id, workspaceId, { name: dto.name });
  }

  async revokeApiKey(apiKeyId: string, workspaceId: string): Promise<void> {
    const key = await this.apiKeyRepo.findById(apiKeyId, workspaceId);
    if (!key) throw new NotFoundException('API key not found');
    await this.apiKeyRepo.softDelete(apiKeyId, workspaceId);
  }

  async validateApiKey(
    payload: JwtApiKeyPayload,
  ): Promise<{ user: User; workspace: Workspace }> {
    const apiKey = await this.apiKeyRepo.findById(
      payload.apiKeyId,
      payload.workspaceId,
    );

    if (!apiKey) {
      throw new UnauthorizedException('API key not found or revoked');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key expired');
    }

    const workspace = await this.workspaceRepo.findById(payload.workspaceId);
    if (!workspace) throw new UnauthorizedException();

    const user = await this.userRepo.findById(payload.sub, payload.workspaceId);
    if (!user || isUserDisabled(user)) throw new UnauthorizedException();

    // fire-and-forget last used update
    this.apiKeyRepo
      .update(apiKey.id, payload.workspaceId, { lastUsedAt: new Date() })
      .catch(() => {});

    return { user, workspace };
  }
}
