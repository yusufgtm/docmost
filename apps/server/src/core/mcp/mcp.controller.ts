import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { McpService } from './mcp.service';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = '2024-11-05';

@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(private readonly mcpService: McpService) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async handleRequest(
    @Body() body: JsonRpcRequest | JsonRpcRequest[],
    @Headers('authorization') authHeader: string,
  ): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    if (Array.isArray(body)) {
      const responses = await Promise.all(
        body.map((req) => this.processRequest(req, authHeader)),
      );
      return responses.filter((r) => r !== null) as JsonRpcResponse[];
    }
    return this.processRequest(body, authHeader);
  }

  private async processRequest(
    req: JsonRpcRequest,
    authHeader: string,
  ): Promise<JsonRpcResponse | null> {
    const id = req.id ?? null;

    // Notifications have no id and require no response
    if (req.id === undefined && req.method?.startsWith('notifications/')) {
      return null;
    }

    try {
      const result = await this.routeMethod(req, authHeader);
      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      const code = this.errorCode(err);
      this.logger.warn(`MCP error [${req.method}]: ${message}`);
      return { jsonrpc: '2.0', id, error: { code, message } };
    }
  }

  private async routeMethod(
    req: JsonRpcRequest,
    authHeader: string,
  ): Promise<unknown> {
    const { method, params = {} } = req;

    switch (method) {
      case 'initialize':
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'docmost', version: '1.0.0' },
        };

      case 'ping':
        return {};

      case 'tools/list': {
        const tools = this.mcpService.getTools();
        return { tools };
      }

      case 'tools/call': {
        const { user, workspace } = await this.mcpService.authenticateRequest(authHeader);
        const toolName = params.name as string;
        const toolArgs = (params.arguments as Record<string, unknown>) ?? {};
        return this.mcpService.callTool(toolName, toolArgs, user, workspace);
      }

      case 'resources/list':
        return { resources: [] };

      case 'prompts/list':
        return { prompts: [] };

      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
    }
  }

  private errorCode(err: unknown): number {
    if (err && typeof err === 'object' && 'code' in err) {
      return (err as { code: number }).code;
    }
    const status = (err as any)?.status ?? (err as any)?.statusCode;
    if (status === 401 || status === 403) return -32001;
    if (status === 404) return -32002;
    return -32603;
  }
}
