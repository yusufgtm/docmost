import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { ApiKeyService } from '../api-key/api-key.service';
import { PageService } from '../page/services/page.service';
import { SpaceService } from '../space/services/space.service';
import { CommentService } from '../comment/comment.service';
import { SearchService } from '../search/search.service';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { TemplateRepo } from '@docmost/db/repos/template/template.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtApiKeyPayload, JwtPayload, JwtType } from '../auth/dto/jwt-payload';
import { isUserDisabled } from '../../common/helpers';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { CreateCommentDto } from '../comment/dto/create-comment.dto';
import { UpdateSpaceDto } from '../space/dto/update-space.dto';
import { markdownToHtml } from '@docmost/editor-ext';
import { htmlToJson } from 'src/collaboration/collaboration.util';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly environmentService: EnvironmentService,
    private readonly userRepo: UserRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly apiKeyService: ApiKeyService,
    private readonly pageService: PageService,
    private readonly spaceService: SpaceService,
    private readonly commentService: CommentService,
    private readonly searchService: SearchService,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly templateRepo: TemplateRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async authenticateRequest(
    authHeader: string,
  ): Promise<{ user: User; workspace: Workspace }> {
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token required');
    }
    const token = authHeader.slice(7);

    let payload: JwtPayload | JwtApiKeyPayload;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.environmentService.getAppSecret(),
      });
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    if (payload.type === JwtType.API_KEY) {
      return this.apiKeyService.validateApiKey(payload as JwtApiKeyPayload);
    }

    if (payload.type !== JwtType.ACCESS) {
      throw new UnauthorizedException('Unsupported token type');
    }

    const p = payload as JwtPayload;
    const workspace = await this.workspaceRepo.findById(p.workspaceId);
    if (!workspace) throw new UnauthorizedException();

    const user = await this.userRepo.findById(p.sub, p.workspaceId);
    if (!user || isUserDisabled(user)) throw new UnauthorizedException();

    return { user, workspace };
  }

  getTools(): McpTool[] {
    return [
      {
        name: 'search_pages',
        description: 'Search for pages in the workspace by keyword',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            spaceId: { type: 'string', description: 'Optional space ID to limit search' },
            limit: { type: 'number', description: 'Max results (default 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_page',
        description: 'Get a page by its ID including its content',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID' },
          },
          required: ['pageId'],
        },
      },
      {
        name: 'create_page',
        description: 'Create a new page in a space',
        inputSchema: {
          type: 'object',
          properties: {
            spaceId: { type: 'string', description: 'Space UUID' },
            title: { type: 'string', description: 'Page title' },
            content: { type: 'string', description: 'Page content in markdown' },
            parentPageId: { type: 'string', description: 'Optional parent page UUID' },
          },
          required: ['spaceId'],
        },
      },
      {
        name: 'update_page',
        description: 'Update a page title or content',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID' },
            title: { type: 'string', description: 'New title' },
            content: { type: 'string', description: 'New content in markdown' },
            operation: {
              type: 'string',
              enum: ['replace', 'append', 'prepend'],
              description: 'How to apply content (default: replace)',
            },
          },
          required: ['pageId'],
        },
      },
      {
        name: 'list_pages',
        description: 'List top-level pages in a space',
        inputSchema: {
          type: 'object',
          properties: {
            spaceId: { type: 'string', description: 'Space UUID' },
            limit: { type: 'number', description: 'Max results (default 50)' },
          },
          required: ['spaceId'],
        },
      },
      {
        name: 'list_child_pages',
        description: 'List child pages of a given page',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Parent page UUID' },
            spaceId: { type: 'string', description: 'Space UUID' },
            limit: { type: 'number', description: 'Max results (default 50)' },
          },
          required: ['pageId', 'spaceId'],
        },
      },
      {
        name: 'duplicate_page',
        description: 'Duplicate a page and its children',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID to duplicate' },
            targetSpaceId: { type: 'string', description: 'Optional target space UUID' },
          },
          required: ['pageId'],
        },
      },
      {
        name: 'copy_page_to_space',
        description: 'Copy a page subtree into another space',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID to copy' },
            targetSpaceId: { type: 'string', description: 'Destination space UUID' },
          },
          required: ['pageId', 'targetSpaceId'],
        },
      },
      {
        name: 'move_page',
        description: 'Move a page to a new parent within the same space',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID to move' },
            parentPageId: { type: 'string', description: 'New parent page UUID (omit for top-level)' },
            position: { type: 'string', description: 'Fractional index position' },
          },
          required: ['pageId'],
        },
      },
      {
        name: 'move_page_to_space',
        description: 'Move a page subtree to another space',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID to move' },
            targetSpaceId: { type: 'string', description: 'Destination space UUID' },
          },
          required: ['pageId', 'targetSpaceId'],
        },
      },
      {
        name: 'get_space',
        description: 'Get details of a space',
        inputSchema: {
          type: 'object',
          properties: {
            spaceId: { type: 'string', description: 'Space UUID' },
          },
          required: ['spaceId'],
        },
      },
      {
        name: 'list_spaces',
        description: 'List all spaces in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default 50)' },
          },
        },
      },
      {
        name: 'create_space',
        description: 'Create a new space in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Space name' },
            slug: { type: 'string', description: 'Alphanumeric slug (2-100 chars)' },
            description: { type: 'string', description: 'Optional description' },
          },
          required: ['name', 'slug'],
        },
      },
      {
        name: 'update_space',
        description: 'Update a space name, slug, or description',
        inputSchema: {
          type: 'object',
          properties: {
            spaceId: { type: 'string', description: 'Space UUID' },
            name: { type: 'string', description: 'New name' },
            slug: { type: 'string', description: 'New slug' },
            description: { type: 'string', description: 'New description' },
          },
          required: ['spaceId'],
        },
      },
      {
        name: 'get_comments',
        description: 'Get comments on a page',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID' },
            limit: { type: 'number', description: 'Max results (default 50)' },
          },
          required: ['pageId'],
        },
      },
      {
        name: 'create_comment',
        description: 'Add a comment to a page',
        inputSchema: {
          type: 'object',
          properties: {
            pageId: { type: 'string', description: 'Page UUID' },
            content: { type: 'string', description: 'Comment text' },
            parentCommentId: { type: 'string', description: 'Optional parent comment UUID for replies' },
          },
          required: ['pageId', 'content'],
        },
      },
      {
        name: 'update_comment',
        description: 'Update the content of a comment',
        inputSchema: {
          type: 'object',
          properties: {
            commentId: { type: 'string', description: 'Comment UUID' },
            content: { type: 'string', description: 'New comment text' },
          },
          required: ['commentId', 'content'],
        },
      },
      {
        name: 'search_attachments',
        description: 'List attachments for a space',
        inputSchema: {
          type: 'object',
          properties: {
            spaceId: { type: 'string', description: 'Space UUID' },
          },
          required: ['spaceId'],
        },
      },
      {
        name: 'list_workspace_members',
        description: 'List members of the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Max results (default 50)' },
          },
        },
      },
      {
        name: 'get_current_user',
        description: 'Get the currently authenticated user',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'list_templates',
        description: 'List templates accessible in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            spaceId: { type: 'string', description: 'Optional space UUID to filter templates' },
            query: { type: 'string', description: 'Optional search query to filter by title or description' },
            limit: { type: 'number', description: 'Max results (default 50)' },
          },
        },
      },
      {
        name: 'get_template',
        description: 'Get a template by ID including its content',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: 'Template UUID' },
          },
          required: ['templateId'],
        },
      },
      {
        name: 'create_template',
        description: 'Create a new template',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Template title' },
            description: { type: 'string', description: 'Template description' },
            content: { type: 'string', description: 'Template content in markdown' },
            spaceId: { type: 'string', description: 'Optional space UUID to scope the template to a space' },
          },
          required: ['title'],
        },
      },
      {
        name: 'create_page_from_template',
        description: 'Create a new page pre-populated with a template\'s content',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: 'Template UUID to use as source' },
            spaceId: { type: 'string', description: 'Destination space UUID' },
            title: { type: 'string', description: 'Page title (defaults to template title)' },
            parentPageId: { type: 'string', description: 'Optional parent page UUID' },
          },
          required: ['templateId', 'spaceId'],
        },
      },
      {
        name: 'delete_template',
        description: 'Delete a template',
        inputSchema: {
          type: 'object',
          properties: {
            templateId: { type: 'string', description: 'Template UUID' },
          },
          required: ['templateId'],
        },
      },
    ];
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    user: User,
    workspace: Workspace,
  ): Promise<McpToolResult> {
    try {
      const text = await this.dispatch(name, args, user, workspace);
      return { content: [{ type: 'text', text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error occurred';
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  }

  private async dispatch(
    name: string,
    args: Record<string, unknown>,
    user: User,
    workspace: Workspace,
  ): Promise<string> {
    switch (name) {
      case 'search_pages':        return this.searchPages(args, user, workspace);
      case 'get_page':            return this.getPage(args, workspace);
      case 'create_page':         return this.createPage(args, user, workspace);
      case 'update_page':         return this.updatePage(args, user, workspace);
      case 'list_pages':          return this.listPages(args, user);
      case 'list_child_pages':    return this.listChildPages(args, user);
      case 'duplicate_page':      return this.duplicatePage(args, user, workspace);
      case 'copy_page_to_space':  return this.copyPageToSpace(args, user, workspace);
      case 'move_page':           return this.movePage(args, workspace);
      case 'move_page_to_space':  return this.movePageToSpace(args, user, workspace);
      case 'get_space':           return this.getSpace(args, workspace);
      case 'list_spaces':         return this.listSpaces(args, workspace);
      case 'create_space':        return this.createSpace(args, user, workspace);
      case 'update_space':        return this.updateSpace(args, workspace);
      case 'get_comments':        return this.getComments(args);
      case 'create_comment':      return this.createComment(args, user, workspace);
      case 'update_comment':      return this.updateComment(args, user);
      case 'search_attachments':  return this.searchAttachments(args);
      case 'list_workspace_members': return this.listWorkspaceMembers(args, workspace);
      case 'get_current_user':    return this.getCurrentUser(user);
      case 'list_templates':      return this.listTemplates(args, user, workspace);
      case 'get_template':        return this.getTemplate(args, workspace);
      case 'create_template':     return this.createTemplate(args, user, workspace);
      case 'create_page_from_template': return this.createPageFromTemplate(args, user, workspace);
      case 'delete_template':     return this.deleteTemplate(args, workspace);
      default:
        throw new NotFoundException(`Unknown tool: ${name}`);
    }
  }

  // ── Tools ────────────────────────────────────────────────────────────────

  private async searchPages(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const result = await this.searchService.searchPage(
      { query: args.query as string, limit: (args.limit as number) ?? 20, spaceId: args.spaceId as string | undefined },
      { userId: user.id, workspaceId: workspace.id },
    );
    return JSON.stringify(result.items, null, 2);
  }

  private async getPage(args: Record<string, unknown>, workspace: Workspace) {
    const page = await this.pageService.findById(args.pageId as string, true);
    if (!page || page.workspaceId !== workspace.id) throw new NotFoundException('Page not found');
    return JSON.stringify({
      id: page.id, slugId: page.slugId, title: page.title, icon: page.icon,
      spaceId: page.spaceId, parentPageId: page.parentPageId,
      creatorId: page.creatorId, createdAt: page.createdAt, updatedAt: page.updatedAt,
      content: page.content,
    }, null, 2);
  }

  private async createPage(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const page = await this.pageService.create(user.id, workspace.id, {
      spaceId: args.spaceId as string,
      title: args.title as string | undefined,
      content: args.content as string | undefined,
      format: args.content ? 'markdown' : undefined,
      parentPageId: args.parentPageId as string | undefined,
    });
    return JSON.stringify({ id: page.id, slugId: page.slugId, title: page.title }, null, 2);
  }

  private async updatePage(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const pageId = args.pageId as string;
    const page = await this.pageService.findById(pageId);
    if (!page || page.workspaceId !== workspace.id) throw new NotFoundException('Page not found');

    const updated = await this.pageService.update(page, {
      pageId,
      title: args.title as string | undefined,
      content: args.content as string | undefined,
      format: args.content ? 'markdown' : undefined,
      operation: (args.operation as 'replace' | 'append' | 'prepend') ?? 'replace',
    }, user);
    return JSON.stringify({ id: updated.id, title: updated.title }, null, 2);
  }

  private async listPages(args: Record<string, unknown>, user: User) {
    const pagination = { limit: (args.limit as number) ?? 50 } as PaginationOptions;
    const result = await this.pageService.getSidebarPages(
      args.spaceId as string, pagination, undefined, user.id, true,
    );
    return JSON.stringify(result.items, null, 2);
  }

  private async listChildPages(args: Record<string, unknown>, user: User) {
    const pagination = { limit: (args.limit as number) ?? 50 } as PaginationOptions;
    const result = await this.pageService.getSidebarPages(
      args.spaceId as string, pagination, args.pageId as string, user.id, true,
    );
    return JSON.stringify(result.items, null, 2);
  }

  private async duplicatePage(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const page = await this.pageService.findById(args.pageId as string);
    if (!page || page.workspaceId !== workspace.id) throw new NotFoundException('Page not found');
    const newPage = await this.pageService.duplicatePage(page, (args.targetSpaceId as string) ?? page.spaceId, user);
    return JSON.stringify({ id: newPage.id, slugId: newPage.slugId, title: newPage.title }, null, 2);
  }

  private async copyPageToSpace(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const page = await this.pageService.findById(args.pageId as string);
    if (!page || page.workspaceId !== workspace.id) throw new NotFoundException('Page not found');
    const newPage = await this.pageService.duplicatePage(page, args.targetSpaceId as string, user);
    return JSON.stringify({ id: newPage.id, title: newPage.title, spaceId: newPage.spaceId }, null, 2);
  }

  private async movePage(args: Record<string, unknown>, workspace: Workspace) {
    const page = await this.pageService.findById(args.pageId as string);
    if (!page || page.workspaceId !== workspace.id) throw new NotFoundException('Page not found');
    await this.pageService.movePage(
      { pageId: args.pageId as string, parentPageId: args.parentPageId as string | undefined, position: args.position as string | undefined },
      page,
    );
    return JSON.stringify({ success: true, pageId: args.pageId }, null, 2);
  }

  private async movePageToSpace(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const page = await this.pageService.findById(args.pageId as string);
    if (!page || page.workspaceId !== workspace.id) throw new NotFoundException('Page not found');
    const result = await this.pageService.movePageToSpace(page, args.targetSpaceId as string, user.id);
    return JSON.stringify({ success: true, movedChildCount: result.childPageIds.length }, null, 2);
  }

  private async getSpace(args: Record<string, unknown>, workspace: Workspace) {
    const space = await this.spaceService.getSpaceInfo(args.spaceId as string, workspace.id);
    return JSON.stringify(space, null, 2);
  }

  private async listSpaces(args: Record<string, unknown>, workspace: Workspace) {
    const result = await this.spaceService.getWorkspaceSpaces(workspace.id, { limit: (args.limit as number) ?? 50 } as PaginationOptions);
    return JSON.stringify(result.items, null, 2);
  }

  private async createSpace(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const space = await this.spaceService.createSpace(user, workspace.id, {
      name: args.name as string,
      slug: args.slug as string,
      description: args.description as string | undefined,
    });
    return JSON.stringify({ id: space.id, name: space.name, slug: space.slug }, null, 2);
  }

  private async updateSpace(args: Record<string, unknown>, workspace: Workspace) {
    const dto = { spaceId: args.spaceId as string, name: args.name as string | undefined, slug: args.slug as string | undefined, description: args.description as string | undefined } as UpdateSpaceDto;
    const updated = await this.spaceService.updateSpace(dto, workspace.id);
    return JSON.stringify({ id: updated.id, name: updated.name, slug: updated.slug }, null, 2);
  }

  private async getComments(args: Record<string, unknown>) {
    const result = await this.commentService.findByPageId(args.pageId as string, { limit: (args.limit as number) ?? 50 } as PaginationOptions);
    return JSON.stringify(result.items, null, 2);
  }

  private async createComment(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const pageId = args.pageId as string;
    const page = await this.pageService.findById(pageId);
    if (!page || page.workspaceId !== workspace.id) throw new NotFoundException('Page not found');

    const prosemirrorContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: args.content as string }] }],
    };

    const commentDto = { pageId, content: JSON.stringify(prosemirrorContent), parentCommentId: args.parentCommentId as string | undefined, type: 'inline', selection: undefined } as unknown as CreateCommentDto;
    const comment = await this.commentService.create(
      { page, workspaceId: workspace.id, user },
      commentDto,
    );
    return JSON.stringify({ id: comment.id, pageId: comment.pageId, createdAt: comment.createdAt }, null, 2);
  }

  private async updateComment(args: Record<string, unknown>, user: User) {
    const comment = await this.commentService.findById(args.commentId as string);
    if (!comment) throw new NotFoundException('Comment not found');

    const prosemirrorContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: args.content as string }] }],
    };

    const updated = await this.commentService.update(comment, { commentId: args.commentId as string, content: prosemirrorContent }, user);
    return JSON.stringify({ id: updated.id, updatedAt: updated.updatedAt }, null, 2);
  }

  private async searchAttachments(args: Record<string, unknown>) {
    const attachments = await this.attachmentRepo.findBySpaceId(args.spaceId as string);
    return JSON.stringify(
      attachments.map((a) => ({
        id: a.id, fileName: a.fileName, fileSize: a.fileSize,
        mimeType: a.mimeType, pageId: a.pageId, createdAt: a.createdAt,
      })),
      null, 2,
    );
  }

  private async listWorkspaceMembers(args: Record<string, unknown>, workspace: Workspace) {
    const result = await this.userRepo.getUsersPaginated(workspace.id, { limit: (args.limit as number) ?? 50 } as PaginationOptions);
    return JSON.stringify(
      result.items.map((u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
      null, 2,
    );
  }

  private getCurrentUser(user: User) {
    return JSON.stringify({ id: user.id, name: user.name, email: user.email, role: user.role, workspaceId: user.workspaceId }, null, 2);
  }

  private async listTemplates(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const accessibleSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(user.id);
    const pagination = {
      limit: (args.limit as number) ?? 50,
      query: args.query as string | undefined,
    } as PaginationOptions;
    const result = await this.templateRepo.findTemplates(
      workspace.id,
      accessibleSpaceIds,
      pagination,
      { spaceId: args.spaceId as string | undefined },
    );
    return JSON.stringify(result.items, null, 2);
  }

  private async getTemplate(args: Record<string, unknown>, workspace: Workspace) {
    const template = await this.templateRepo.findById(
      args.templateId as string,
      workspace.id,
      { includeContent: true },
    );
    if (!template) throw new NotFoundException('Template not found');
    return JSON.stringify(template, null, 2);
  }

  private async createTemplate(args: Record<string, unknown>, user: User, workspace: Workspace) {
    let content: object | undefined;
    if (args.content) {
      const html = await markdownToHtml(args.content as string);
      content = htmlToJson(html as string);
    }
    const result = await this.templateRepo.insertTemplate({
      title: args.title as string,
      description: (args.description as string) ?? null,
      content: (content ?? null) as any,
      spaceId: (args.spaceId as string) ?? null,
      workspaceId: workspace.id,
      creatorId: user.id,
      lastUpdatedById: user.id,
    });
    return JSON.stringify({ id: result.id }, null, 2);
  }

  private async createPageFromTemplate(args: Record<string, unknown>, user: User, workspace: Workspace) {
    const template = await this.templateRepo.findById(
      args.templateId as string,
      workspace.id,
      { includeContent: true },
    );
    if (!template) throw new NotFoundException('Template not found');

    const page = await this.pageService.create(user.id, workspace.id, {
      spaceId: args.spaceId as string,
      title: (args.title as string) ?? template.title ?? undefined,
      content: (template.content as object) ?? undefined,
      format: template.content ? 'json' : undefined,
      parentPageId: args.parentPageId as string | undefined,
    });
    return JSON.stringify({ id: page.id, slugId: page.slugId, title: page.title }, null, 2);
  }

  private async deleteTemplate(args: Record<string, unknown>, workspace: Workspace) {
    const template = await this.templateRepo.findById(
      args.templateId as string,
      workspace.id,
    );
    if (!template) throw new NotFoundException('Template not found');
    await this.templateRepo.deleteTemplate(args.templateId as string, workspace.id);
    return JSON.stringify({ success: true, templateId: args.templateId }, null, 2);
  }
}
