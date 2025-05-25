# MyDevTool

A Zod-powered CLI framework for building command-line tools in TypeScript.

## Features

- **Type-safe commands** with input/output validation using Zod schemas
- **Command hierarchy** with subcommands and grouping
- **Middleware system** for cross-cutting concerns
- **Plugin architecture** for extensibility
- **Configuration management** with multiple file formats (JSON, YAML, JS, TS)
- **Environment variable support** with automatic type conversion
- **Comprehensive logging** with different levels
- **Command aliases** for better UX
- **Built-in help system** with automatic documentation generation

## Installation

```bash
npm install mydevtool
# or
yarn add mydevtool
# or
pnpm add mydevtool
```

## Quick Start

### Basic CLI Setup

```typescript
import MyDevTool, { z } from 'mydevtool';

const cli = new MyDevTool({
  name: "my-cli",
  version: "1.0.0", 
  description: "My awesome CLI tool",
  aliases: ["mycli", "mc"]
});

// Add a simple command
cli.add({
  command: "greet",
  description: "Greet someone"
})
.input(z.object({
  name: z.string().describe("Name of the person to greet"),
  uppercase: z.boolean().optional().describe("Convert to uppercase")
}))
.action(async ({ parsedInput }) => {
  const greeting = `Hello, ${parsedInput.name}!`;
  return {
    message: parsedInput.uppercase ? greeting.toUpperCase() : greeting
  };
});

// Run the CLI
cli.run();
```

### Advanced Example with Subcommands

```typescript
import MyDevTool, { z } from 'mydevtool';

const cli = new MyDevTool({
  name: "devtool",
  version: "2.0.0",
  description: "A development toolkit"
});

// Parent command with subcommands
const userCmd = cli.add({
  command: "user",
  description: "User management commands",
  group: "Management"
});

// Add subcommand
userCmd.sub("create")
  .input(z.object({
    email: z.string().email(),
    name: z.string(),
    admin: z.boolean().default(false)
  }))
  .action(async ({ parsedInput, context }) => {
    context.logger.info(`Creating user: ${parsedInput.name}`);
    // User creation logic here
    return { userId: "123", created: true };
  });

// Another subcommand
userCmd.sub("delete")
  .input(z.object({
    userId: z.string(),
    force: z.boolean().default(false)
  }))
  .action(async ({ parsedInput, context }) => {
    if (!parsedInput.force) {
      context.logger.warn("Use --force to confirm deletion");
      return { deleted: false };
    }
    // Deletion logic here
    return { deleted: true };
  });

cli.run();
```

## Configuration Management

MyDevTool supports multiple configuration file formats and environment variables:

```typescript
import MyDevTool, { z } from 'mydevtool';

const configSchema = z.object({
  database: z.object({
    host: z.string().default("localhost"),
    port: z.number().default(5432),
    name: z.string()
  }),
  debug: z.boolean().default(false)
});

const cli = new MyDevTool({
  name: "my-app"
});

cli.configure({
  schema: configSchema,
  configFiles: [
    "./config.json",
    "./config.yaml", 
    "./config.js",
    "./config.ts"
  ],
  envPrefix: "MYAPP_",
  defaults: {
    database: {
      host: "localhost",
      port: 5432
    }
  }
});

cli.add({
  command: "connect",
  description: "Connect to database"
})
.input(z.object({}))
.action(async ({ config, context }) => {
  const dbConfig = config as z.infer<typeof configSchema>;
  context.logger.info(`Connecting to ${dbConfig.database.host}:${dbConfig.database.port}`);
  // Connection logic here
});

cli.run();
```

## Middleware System

Add cross-cutting functionality with middleware:

```typescript
import MyDevTool, { z, createMiddleware } from 'mydevtool';

const cli = new MyDevTool({ name: "my-cli" });

// Create authentication middleware
const authMiddleware = createMiddleware().define(async ({ parsedInput, ctx, next }) => {
  // Check authentication
  const isAuthenticated = checkAuth(); // Your auth logic
  
  if (!isAuthenticated) {
    throw new Error("Authentication required");
  }

  // Add user info to context
  const result = await next({ 
    ctx: { 
      ...ctx, 
      user: { id: "123", name: "John" } 
    } 
  });
  
  return result;
});

// Apply middleware globally
cli.use(authMiddleware);

// Or apply to specific commands
cli.add({
  command: "protected",
  description: "A protected command"
})
.use(authMiddleware)
.input(z.object({}))
.action(async ({ context }) => {
  // Access user from context
  const user = context.user;
  return { message: `Hello ${user.name}` };
});

cli.run();
```

## Plugin System

Extend functionality with plugins:

```typescript
// plugin.ts
import { Plugin, CliBuilder } from 'mydevtool';

const myPlugin: Plugin = {
  name: "my-plugin",
  version: "1.0.0",
  description: "My awesome plugin",
  initialize: (cli: CliBuilder) => {
    cli.add({
      command: "plugin-command",
      description: "Command added by plugin"
    })
    .input(z.object({}))
    .action(async () => {
      return { message: "Hello from plugin!" };
    });
  }
};

export default myPlugin;
```

```json
// mydevtool-plugin.json
{
  "name": "my-plugin",
  "version": "1.0.0", 
  "description": "My awesome plugin",
  "main": "plugin.js",
  "type": "javascript"
}
```

Load plugins:

```typescript
const cli = new MyDevTool({ name: "my-cli" });

cli.run({
  pluginsDir: "./plugins"
});
```

## Command Examples and Aliases

```typescript
cli.add({
  command: "deploy",
  description: "Deploy application"
})
.input(z.object({
  environment: z.enum(["dev", "staging", "prod"]),
  force: z.boolean().default(false)
}))
.aliases(["d", "ship"])
.examples([
  { environment: "dev" },
  { environment: "prod", force: true }
])
.action(async ({ parsedInput }) => {
  // Deploy logic
  return { deployed: true, environment: parsedInput.environment };
});
```

## Built-in Commands

MyDevTool automatically provides:

- `help` - Display help information
- `version` - Show version information
- `help <command>` - Show help for specific command

## CLI Usage

```bash
# Basic usage
my-cli greet --name "World"

# Subcommands  
my-cli user create --email "user@example.com" --name "John Doe"

# Using aliases
my-cli d --environment prod --force

# Get help
my-cli help
my-cli help user
my-cli help user create

# Version info
my-cli version
```

## Environment Variables

Configuration can be loaded from environment variables:

```bash
# With envPrefix: "MYAPP_"
export MYAPP_DATABASE_HOST=localhost
export MYAPP_DATABASE_PORT=5432
export MYAPP_DEBUG=true
```

## TypeScript Support

MyDevTool is built with TypeScript and provides full type safety:

```typescript
import MyDevTool, { z, CommandHandler } from 'mydevtool';

// Type-safe input/output schemas
const inputSchema = z.object({
  count: z.number().min(1),
  format: z.enum(["json", "table"])
});

const outputSchema = z.object({
  results: z.array(z.string()),
  total: z.number()
});

// Type-safe handler
const handler: CommandHandler<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = async ({ parsedInput }) => {
  return {
    results: Array(parsedInput.count).fill("item"),
    total: parsedInput.count
  };
};

cli.add({
  command: "generate",
  description: "Generate items"
})
.input(inputSchema)
.output(outputSchema)
.action(handler);
```

## API Reference

### MyDevTool Class

- `constructor(metadata?: CliMetadata)` - Create new CLI instance
- `add(config: CommandConfig)` - Add a command
- `configure(options: ConfigOptions)` - Set up configuration
- `run(options?: CliOptions)` - Run the CLI
- `setMetadata(metadata: CliMetadata)` - Update CLI metadata

### ActionBuilder Class

- `input(schema: ZodType)` - Set input validation schema
- `output(schema: ZodType)` - Set output validation schema  
- `action(handler: CommandHandler)` - Set command handler
- `use(middleware: Middleware)` - Add middleware
- `sub(name: string)` - Add subcommand
- `aliases(aliases: string[])` - Set command aliases
- `examples(examples: any[])` - Add usage examples
- `meta(metadata: object)` - Set command metadata

