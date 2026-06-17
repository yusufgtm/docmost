import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TemplateRepo } from '@docmost/db/repos/template/template.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PageService } from '../page/services/page.service';
import { Template, User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  UseTemplateDto,
} from './dto/template.dto';

@Injectable()
export class TemplateService {
  constructor(
    private readonly templateRepo: TemplateRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageService: PageService,
  ) {}

  async listTemplates(
    user: User,
    workspace: Workspace,
    params: { spaceId?: string; cursor?: string; limit?: number; query?: string },
  ) {
    const accessibleSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(
      user.id,
    );
    const pagination: PaginationOptions = {
      limit: params.limit ?? 30,
      cursor: params.cursor,
      query: params.query,
    } as PaginationOptions;

    return this.templateRepo.findTemplates(
      workspace.id,
      accessibleSpaceIds,
      pagination,
      { spaceId: params.spaceId },
    );
  }

  async getTemplateById(
    templateId: string,
    user: User,
    workspace: Workspace,
  ): Promise<Template> {
    const template = await this.templateRepo.findById(templateId, workspace.id, {
      includeContent: true,
    });
    if (!template) throw new NotFoundException('Template not found');

    await this.assertAccess(template, user);
    return template;
  }

  async createTemplate(
    dto: CreateTemplateDto,
    user: User,
    workspace: Workspace,
  ): Promise<Template> {
    if (dto.spaceId) {
      await this.assertSpaceMember(dto.spaceId, user.id);
    } else {
      this.assertAdmin(user);
    }

    const result = await this.templateRepo.insertTemplate({
      title: dto.title,
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      content: (dto.content ?? null) as any,
      spaceId: dto.spaceId ?? null,
      workspaceId: workspace.id,
      creatorId: user.id,
      lastUpdatedById: user.id,
    });

    return this.templateRepo.findById(result.id, workspace.id, {
      includeContent: true,
    });
  }

  async updateTemplate(
    dto: UpdateTemplateDto,
    user: User,
    workspace: Workspace,
  ): Promise<Template> {
    const template = await this.templateRepo.findById(
      dto.templateId,
      workspace.id,
    );
    if (!template) throw new NotFoundException('Template not found');

    await this.assertEditAccess(template, user);

    await this.templateRepo.updateTemplate(
      {
        title: dto.title ?? template.title,
        description: dto.description !== undefined ? dto.description : template.description,
        icon: dto.icon !== undefined ? dto.icon : template.icon,
        content: dto.content !== undefined ? (dto.content as any) : template.content,
        spaceId: dto.spaceId !== undefined ? (dto.spaceId || null) : template.spaceId,
        lastUpdatedById: user.id,
      },
      dto.templateId,
      workspace.id,
    );

    return this.templateRepo.findById(dto.templateId, workspace.id, {
      includeContent: true,
    });
  }

  async deleteTemplate(
    templateId: string,
    user: User,
    workspace: Workspace,
  ): Promise<void> {
    const template = await this.templateRepo.findById(templateId, workspace.id);
    if (!template) throw new NotFoundException('Template not found');

    await this.assertEditAccess(template, user);
    await this.templateRepo.deleteTemplate(templateId, workspace.id);
  }

  async useTemplate(
    dto: UseTemplateDto,
    user: User,
    workspace: Workspace,
  ) {
    const template = await this.templateRepo.findById(dto.templateId, workspace.id, {
      includeContent: true,
    });
    if (!template) throw new NotFoundException('Template not found');

    await this.assertSpaceMember(dto.spaceId, user.id);

    return this.pageService.create(user.id, workspace.id, {
      spaceId: dto.spaceId,
      title: template.title ?? undefined,
      icon: template.icon ?? undefined,
      content: template.content ? (template.content as object) : undefined,
      format: template.content ? 'json' : undefined,
      parentPageId: dto.parentPageId,
    });
  }

  private async assertAccess(template: Template, user: User): Promise<void> {
    if (!template.spaceId) return; // workspace-wide templates are accessible to all
    const spaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
    if (!spaceIds.includes(template.spaceId)) {
      throw new ForbiddenException('Access denied');
    }
  }

  private async assertEditAccess(template: Template, user: User): Promise<void> {
    if (user.role === 'admin' || user.role === 'owner') return;
    if (template.creatorId === user.id) return;
    throw new ForbiddenException('Only the creator or an admin can modify this template');
  }

  private async assertSpaceMember(spaceId: string, userId: string): Promise<void> {
    const spaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);
    if (!spaceIds.includes(spaceId)) {
      throw new ForbiddenException('You are not a member of this space');
    }
  }

  private assertAdmin(user: User): void {
    if (user.role !== 'admin' && user.role !== 'owner') {
      throw new ForbiddenException('Only admins can create workspace-wide templates');
    }
  }
}
