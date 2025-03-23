#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import * as yaml from "js-yaml";
import { z } from "zod";

// Disable 'any' type warnings for this file as we're focusing on fixing downlevelIteration
/* eslint-disable @typescript-eslint/no-explicit-any */

// Core types
export type CommandHandler<T, R = unknown> = (args: {
	parsedInput: T;
	context: CommandContext;
	config: unknown;
}) => Promise<R> | R;

export interface CommandContext {
	logger: Logger;
	[key: string]: unknown;
}

export interface CommandDefinition<T, R = unknown> {
	name: string;
	description: string;
	inputSchema: z.ZodType<T>;
	outputSchema?: z.ZodType<R>;
	metadata?: Record<string, unknown>;
	handler: CommandHandler<T, R>;
	aliases?: string[];
	examples?: T[];
	subcommands?: CommandDefinition<unknown, unknown>[];
	parent?: string;
	middleware?: Middleware<unknown, unknown>[];
}

export interface CommandConfig {
	command: string;
	description?: string;
	title?: string;
	group?: string;
	tags?: string[];
	[key: string]: unknown;
}

export interface CliMetadata {
	name: string;
	description?: string;
	version?: string;
	author?: string;
	homepage?: string;
	license?: string;
	repository?: string;
	aliases?: string[];
	[key: string]: unknown;
}

export interface Logger {
	info: (message: string) => void;
	error: (message: string) => void;
	warn: (message: string) => void;
	success: (message: string) => void;
	debug: (message: string) => void;
}

export class ConsoleLogger implements Logger {
	private readonly debugEnabled: boolean;

	constructor(debug = false) {
		this.debugEnabled = debug;
	}

	info(message: string): void {
		console.log(chalk.blue("info:"), message);
	}

	error(message: string): void {
		console.error(chalk.red("error:"), message);
	}

	warn(message: string): void {
		console.warn(chalk.yellow("warn:"), message);
	}

	success(message: string): void {
		console.log(chalk.green("success:"), message);
	}

	debug(message: string): void {
		if (this.debugEnabled) {
			console.log(chalk.gray("debug:"), message);
		}
	}
}

export interface Plugin {
	name: string;
	version: string;
	description?: string;
	author?: string;
	initialize: (cli: CliBuilder) => void;
}

export const pluginManifestSchema = z.object({
	name: z.string(),
	version: z.string(),
	description: z.string().optional(),
	author: z.string().optional(),
	main: z.string(),
	type: z.enum(["typescript", "javascript"]).default("javascript"),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export interface ConfigOptions<T> {
	schema: z.ZodType<T>;
	configFiles?: string[];
	envPrefix?: string;
	defaults?: Partial<T>;
}

export interface CliOptions {
	debug?: boolean;
	pluginsDir?: string;
}

// Define a type for configuration values - simplify to avoid type issues
export type ConfigValue = unknown;
export interface ConfigObject {
	[key: string]: ConfigValue;
}

export interface ConfigLoader {
	canLoad(filePath: string): boolean;
	load(filePath: string): ConfigObject;
}

export class JsConfigLoader implements ConfigLoader {
	canLoad(filePath: string): boolean {
		return filePath.endsWith(".js");
	}

	load(filePath: string): ConfigObject {
		try {
			return require(path.resolve(filePath));
		} catch (error) {
			throw new Error(
				`Failed to load JS config from ${filePath}: ${(error as Error).message}`,
			);
		}
	}
}

export class TsConfigLoader implements ConfigLoader {
	canLoad(filePath: string): boolean {
		return filePath.endsWith(".ts");
	}

	load(filePath: string): ConfigObject {
		try {
			try {
				require("ts-node/register");
			} catch (e) {
				throw new Error(
					"Failed to load TypeScript config. Is ts-node installed?",
				);
			}
			return require(path.resolve(filePath));
		} catch (error) {
			throw new Error(
				`Failed to load TS config from ${filePath}: ${(error as Error).message}`,
			);
		}
	}
}

export class JsonConfigLoader implements ConfigLoader {
	canLoad(filePath: string): boolean {
		return filePath.endsWith(".json");
	}

	load(filePath: string): ConfigObject {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			return JSON.parse(content);
		} catch (error) {
			throw new Error(
				`Failed to load JSON config from ${filePath}: ${(error as Error).message}`,
			);
		}
	}
}

export class YamlConfigLoader implements ConfigLoader {
	canLoad(filePath: string): boolean {
		return filePath.endsWith(".yml") || filePath.endsWith(".yaml");
	}

	load(filePath: string): ConfigObject {
		try {
			const content = fs.readFileSync(filePath, "utf-8");
			return yaml.load(content) as ConfigObject;
		} catch (error) {
			throw new Error(
				`Failed to load YAML config from ${filePath}: ${(error as Error).message}`,
			);
		}
	}
}

export class ConfigLoaderRegistry {
	private loaders: ConfigLoader[] = [];

	constructor() {
		this.registerLoader(new JsConfigLoader());
		this.registerLoader(new TsConfigLoader());
		this.registerLoader(new JsonConfigLoader());
		this.registerLoader(new YamlConfigLoader());
	}

	registerLoader(loader: ConfigLoader): void {
		this.loaders.push(loader);
	}

	getLoaderForFile(filePath: string): ConfigLoader | undefined {
		return this.loaders.find((loader) => loader.canLoad(filePath));
	}
}

export class PluginManager {
	private plugins: Map<string, Plugin> = new Map();
	private cli: CliBuilder;
	private logger: Logger;

	constructor(cli: CliBuilder, logger: Logger) {
		this.cli = cli;
		this.logger = logger;
	}

	async loadPluginsFromDirectory(pluginsDir: string): Promise<void> {
		try {
			if (!fs.existsSync(pluginsDir)) {
				this.logger.warn(`Plugins directory not found: ${pluginsDir}`);
				return;
			}

			const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
			const pluginDirs = entries
				.filter((entry) => entry.isDirectory())
				.map((entry) => path.join(pluginsDir, entry.name));

			for (const pluginDir of pluginDirs) {
				await this.loadPlugin(pluginDir);
			}

			this.logger.info(`Loaded ${this.plugins.size} plugins`);
		} catch (error) {
			this.logger.error(
				`Error loading plugins: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private async loadPlugin(pluginDir: string): Promise<void> {
		try {
			const manifestPath = path.join(pluginDir, "devtool-plugin.json");

			if (!fs.existsSync(manifestPath)) {
				this.logger.warn(`Plugin manifest not found: ${manifestPath}`);
				return;
			}

			const manifestContent = fs.readFileSync(manifestPath, "utf-8");
			const manifest = pluginManifestSchema.parse(JSON.parse(manifestContent));

			if (this.plugins.has(manifest.name)) {
				this.logger.warn(`Plugin ${manifest.name} is already loaded`);
				return;
			}

			const mainPath = path.join(pluginDir, manifest.main);
			if (!fs.existsSync(mainPath)) {
				this.logger.error(`Plugin main file not found: ${mainPath}`);
				return;
			}

			const pluginModule = await import(mainPath);
			const plugin: Plugin = pluginModule.default || pluginModule;

			if (!plugin || typeof plugin.initialize !== "function") {
				this.logger.error(`Invalid plugin module: ${manifest.name}`);
				return;
			}

			plugin.name = manifest.name;
			plugin.version = manifest.version;
			plugin.description = manifest.description;
			plugin.author = manifest.author;

			this.plugins.set(plugin.name, plugin);

			plugin.initialize(this.cli);

			this.logger.info(`Loaded plugin: ${plugin.name} v${plugin.version}`);
		} catch (error) {
			this.logger.error(
				`Error loading plugin from ${pluginDir}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	getPlugin(name: string): Plugin | undefined {
		return this.plugins.get(name);
	}

	getAllPlugins(): Plugin[] {
		return Array.from(this.plugins.values());
	}
}

export class ConfigManager<T> {
	private schema: z.ZodType<T>;
	private configFiles: string[];
	private envPrefix: string;
	private defaults: Partial<T>;
	private logger: Logger;
	private config: T | null = null;
	private loaderRegistry: ConfigLoaderRegistry;

	constructor(options: ConfigOptions<T>, logger: Logger) {
		this.schema = options.schema;
		this.configFiles = options.configFiles || [];
		this.envPrefix = options.envPrefix || "";
		this.defaults = options.defaults || {};
		this.logger = logger;
		this.loaderRegistry = new ConfigLoaderRegistry();
	}

	registerLoader(loader: ConfigLoader): void {
		this.loaderRegistry.registerLoader(loader);
	}

	async loadConfig(commandLineArgs: Record<string, unknown> = {}): Promise<T> {
		try {
			let configData: Partial<T> = { ...this.defaults };

			configData = this.mergeConfig(configData, this.loadFromEnv());
			configData = this.mergeConfig(configData, await this.loadFromFiles());
			configData = this.mergeConfig(configData, commandLineArgs as Partial<T>);

			const validatedConfig = this.schema.parse(configData);

			this.config = validatedConfig;
			return validatedConfig;
		} catch (error) {
			if (error instanceof z.ZodError) {
				this.logger.error("Configuration validation error:");
				error.errors.forEach((err) => {
					this.logger.error(`- ${err.path.join(".")}: ${err.message}`);
				});
			} else {
				this.logger.error(
					`Error loading configuration: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			const defaultConfig = this.schema.parse(this.defaults);
			this.config = defaultConfig;
			return defaultConfig;
		}
	}

	getConfig(): T {
		if (!this.config) {
			throw new Error("Configuration not loaded");
		}
		return this.config;
	}

	private loadFromEnv(): Partial<T> {
		const config: ConfigObject = {};

		if (!this.envPrefix) {
			return config as Partial<T>;
		}

		for (const [key, value] of Object.entries(process.env)) {
			if (key.startsWith(this.envPrefix) && value !== undefined) {
				const configKey = key.slice(this.envPrefix.length).toLowerCase();
				const configPath = configKey.split("_");

				let current = config;
				for (let i = 0; i < configPath.length - 1; i++) {
					const segment = configPath[i];
					if (!current[segment]) {
						current[segment] = {};
					}
					current = current[segment] as ConfigObject;
				}

				const lastSegment = configPath[configPath.length - 1];

				if (value.toLowerCase() === "true") {
					current[lastSegment] = true;
				} else if (value.toLowerCase() === "false") {
					current[lastSegment] = false;
				} else if (/^-?\d+$/.test(value)) {
					current[lastSegment] = Number.parseInt(value, 10);
				} else if (/^-?\d+\.\d+$/.test(value)) {
					current[lastSegment] = Number.parseFloat(value);
				} else {
					current[lastSegment] = value;
				}
			}
		}

		return config as Partial<T>;
	}

	private async loadFromFiles(): Promise<Partial<T>> {
		for (const configFile of this.configFiles) {
			try {
				if (fs.existsSync(configFile)) {
					const loader = this.loaderRegistry.getLoaderForFile(configFile);

					if (!loader) {
						this.logger.warn(`No loader found for config file: ${configFile}`);
						continue;
					}

					const config = loader.load(configFile);
					this.logger.info(`Loaded config from ${configFile}`);
					return config as Partial<T>;
				}
			} catch (error) {
				this.logger.warn(
					`Error loading config from ${configFile}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return {} as Partial<T>;
	}

	private mergeConfig<K extends Partial<T>>(target: K, source: K): K {
		const result = { ...target } as K;

		for (const key in source) {
			if (Object.prototype.hasOwnProperty.call(source, key)) {
				const value = source[key];

				if (
					value !== null &&
					typeof value === "object" &&
					!Array.isArray(value)
				) {
					// @ts-ignore - Complex merging of generic objects
					result[key] = this.mergeConfig((result[key] || {}) as K, value as K);
				} else {
					// @ts-ignore - Assignment to generic object
					result[key] = value;
				}
			}
		}

		return result;
	}
}

// Middleware types and implementation
export interface MiddlewareArgs<
	T,
	Context,
	Metadata = Record<string, unknown>,
> {
	parsedInput: T;
	ctx: Context;
	metadata?: Metadata;
	next: (options?: { ctx?: Partial<Context> }) => Promise<
		MiddlewareResult<unknown, Context>
	>;
}

export interface MiddlewareResult<R, Context> {
	result: R;
	ctx: Context;
}

export type MiddlewareFunction<
	T,
	R,
	Context,
	Metadata = Record<string, unknown>,
> = (
	args: MiddlewareArgs<T, Context, Metadata>,
) => Promise<MiddlewareResult<R, Context>>;

export interface Middleware<Context, Metadata = Record<string, unknown>> {
	execute: <T, R>(args: {
		parsedInput: T;
		ctx: Context;
		metadata?: Metadata;
		handler: (args: { parsedInput: T; ctx: Context }) => Promise<R> | R;
	}) => Promise<R>;
}

export class MiddlewareBuilder<
	Context extends Record<string, unknown> = Record<string, unknown>,
	Metadata = Record<string, unknown>,
> {
	define<T, R>(
		fn: MiddlewareFunction<T, R, Context, Metadata>,
	): Middleware<Context, Metadata> {
		return {
			execute: async <InputT, ResultT>({
				parsedInput,
				ctx,
				metadata,
				handler,
			}: {
				parsedInput: InputT;
				ctx: Context;
				metadata?: Metadata;
				handler: (args: { parsedInput: InputT; ctx: Context }) =>
					| Promise<ResultT>
					| ResultT;
			}): Promise<ResultT> => {
				const result = await fn({
					parsedInput: parsedInput as unknown as T,
					ctx,
					metadata,
					next: async (options?: { ctx?: Partial<Context> }) => {
						const newCtx = options?.ctx ? { ...ctx, ...options.ctx } : ctx;

						const handlerResult = await handler({
							parsedInput,
							ctx: newCtx,
						});

						return {
							result: handlerResult as unknown as R,
							ctx: newCtx,
						};
					},
				});

				return result.result as unknown as ResultT;
			},
		};
	}
}

export function createMiddleware<
	Context extends Record<string, unknown> = Record<string, unknown>,
	Metadata = Record<string, unknown>,
>(): MiddlewareBuilder<Context, Metadata> {
	return new MiddlewareBuilder<Context, Metadata>();
}

export class ActionBuilder<T = unknown, R = unknown> {
	private name = "";
	private description = "";
	private inputZodSchema: z.ZodType<T> | null = null;
	private outputZodSchema: z.ZodType<R> | null = null;
	private commandMetadata: Record<string, unknown> = {};
	private handlerFn: CommandHandler<T, R> | null = null;
	private commandAliases: string[] = [];
	private commandExamples: T[] = [];
	private commandSubcommands: CommandDefinition<unknown, unknown>[] = [];
	private parentCommand: string | undefined = undefined;
	private cliBuilder: CliBuilder | null = null;
	private middlewareFunctions: Middleware<unknown, unknown>[] = [];

	constructor(name?: string, description?: string, parent?: string) {
		if (name) {
			this.name = name;
		}
		if (description) {
			this.description = description;
		}
		this.parentCommand = parent;
	}

	setCliBuilder(cliBuilder: CliBuilder): void {
		this.cliBuilder = cliBuilder;
	}

	input(schema: z.ZodType<T>): ActionBuilder<T, R> {
		const newBuilder = new ActionBuilder<T, R>();
		newBuilder.name = this.name;
		newBuilder.description = this.description;
		newBuilder.inputZodSchema = schema;
		newBuilder.outputZodSchema = this.outputZodSchema;
		newBuilder.commandMetadata = this.commandMetadata;
		newBuilder.commandAliases = this.commandAliases;
		newBuilder.commandExamples = this.commandExamples;
		newBuilder.commandSubcommands = this.commandSubcommands;
		newBuilder.parentCommand = this.parentCommand;
		newBuilder.cliBuilder = this.cliBuilder;
		newBuilder.middlewareFunctions = [...this.middlewareFunctions];
		return newBuilder;
	}

	output(schema: z.ZodType<R>): ActionBuilder<T, R> {
		const newBuilder = new ActionBuilder<T, R>();
		newBuilder.name = this.name;
		newBuilder.description = this.description;
		newBuilder.inputZodSchema = this.inputZodSchema;
		newBuilder.outputZodSchema = schema;
		newBuilder.commandMetadata = this.commandMetadata;
		newBuilder.commandAliases = this.commandAliases;
		newBuilder.commandExamples = this.commandExamples;
		newBuilder.commandSubcommands = this.commandSubcommands;
		newBuilder.parentCommand = this.parentCommand;
		newBuilder.cliBuilder = this.cliBuilder;
		newBuilder.middlewareFunctions = [...this.middlewareFunctions];
		return newBuilder;
	}

	meta(metadata: Record<string, unknown>): ActionBuilder<T, R> {
		this.commandMetadata = { ...this.commandMetadata, ...metadata };
		return this;
	}

	examples(examples: T[]): ActionBuilder<T, R> {
		this.commandExamples = examples;
		return this;
	}

	aliases(aliases: string[]): ActionBuilder<T, R> {
		this.commandAliases = aliases;
		return this;
	}

	use<
		MiddlewareContext extends Record<string, unknown>,
		MiddlewareMetadata extends Record<string, unknown>,
	>(
		middlewareFn:
			| MiddlewareFunction<T, R, MiddlewareContext, MiddlewareMetadata>
			| Middleware<MiddlewareContext, MiddlewareMetadata>,
	): ActionBuilder<T, R> {
		const newBuilder = new ActionBuilder<T, R>();
		newBuilder.name = this.name;
		newBuilder.description = this.description;
		newBuilder.inputZodSchema = this.inputZodSchema;
		newBuilder.outputZodSchema = this.outputZodSchema;
		newBuilder.commandMetadata = this.commandMetadata;
		newBuilder.commandAliases = this.commandAliases;
		newBuilder.commandExamples = this.commandExamples;
		newBuilder.commandSubcommands = this.commandSubcommands;
		newBuilder.parentCommand = this.parentCommand;
		newBuilder.cliBuilder = this.cliBuilder;

		// Copy existing middleware
		newBuilder.middlewareFunctions = [...this.middlewareFunctions];

		// Add new middleware
		if (typeof middlewareFn === "function") {
			// If it's a function, convert it to a middleware
			const middleware = createMiddleware<
				MiddlewareContext,
				MiddlewareMetadata
			>().define(middlewareFn);
			newBuilder.middlewareFunctions.push(
				middleware as unknown as Middleware<unknown, unknown>,
			);
		} else {
			// If it's already a middleware object
			newBuilder.middlewareFunctions.push(
				middlewareFn as unknown as Middleware<unknown, unknown>,
			);
		}

		return newBuilder;
	}

	action<NewR>(handler: CommandHandler<T, NewR>): CommandDefinition<T, NewR> {
		if (!this.name) {
			throw new Error("Command name is required");
		}

		if (!this.inputZodSchema) {
			throw new Error("Command input schema is required");
		}

		// Create a wrapped handler that applies middleware
		const wrappedHandler: CommandHandler<T, NewR> = async (args) => {
			if (this.middlewareFunctions.length === 0) {
				// No middleware, just call the handler directly
				return handler(args);
			}

			let result: NewR;
			let currentCtx = { ...args.context };

			// Apply middleware in sequence
			const applyMiddleware = async (index: number): Promise<NewR> => {
				if (index >= this.middlewareFunctions.length) {
					// All middleware applied, call the handler
					return handler({
						...args,
						context: currentCtx,
					});
				}

				const middleware = this.middlewareFunctions[index];
				return middleware.execute({
					parsedInput: args.parsedInput,
					ctx: currentCtx,
					metadata: this.commandMetadata,
					handler: async ({ parsedInput, ctx }) => {
						// Update the context for the next middleware or final handler
						currentCtx = ctx as CommandContext;
						return applyMiddleware(index + 1);
					},
				}) as Promise<NewR>;
			};

			return applyMiddleware(0);
		};

		const command: CommandDefinition<T, NewR> = {
			name: this.name,
			description: this.description,
			inputSchema: this.inputZodSchema,
			outputSchema: this.outputZodSchema as unknown as
				| z.ZodType<NewR>
				| undefined,
			metadata:
				Object.keys(this.commandMetadata).length > 0
					? this.commandMetadata
					: undefined,
			handler: wrappedHandler,
			aliases: this.commandAliases,
			examples: this.commandExamples,
			subcommands: this.commandSubcommands,
			parent: this.parentCommand,
			middleware:
				this.middlewareFunctions.length > 0
					? this.middlewareFunctions
					: undefined,
		};

		if (this.cliBuilder) {
			this.cliBuilder.registerCommand(
				command as unknown as CommandDefinition<unknown, unknown>,
			);
		}

		return command;
	}

	sub(nameOrConfig: string | CommandConfig): ActionBuilder<unknown, unknown> {
		if (typeof nameOrConfig === "string") {
			const subBuilder = new ActionBuilder(nameOrConfig, "", this.name);
			subBuilder.cliBuilder = this.cliBuilder;

			// Internal representation uses colon delimiter
			const fullName = this.name
				? `${this.name}:${nameOrConfig}`
				: nameOrConfig;
			subBuilder.name = fullName;

			subBuilder.commandMetadata = { group: "default" };

			// Inherit middleware from parent
			subBuilder.middlewareFunctions = [...this.middlewareFunctions];

			return subBuilder;
		}
		const {
			command,
			description: cmdDesc,
			group = "default",
			...restMetadata
		} = nameOrConfig;

		const subBuilder = new ActionBuilder(command, cmdDesc || "", this.name);
		subBuilder.cliBuilder = this.cliBuilder;

		// Internal representation uses colon delimiter
		const fullName = this.name ? `${this.name}:${command}` : command;
		subBuilder.name = fullName;

		subBuilder.commandMetadata = {
			group,
			...restMetadata,
		};

		// Inherit middleware from parent
		subBuilder.middlewareFunctions = [...this.middlewareFunctions];

		return subBuilder;
	}
}

export class CliBuilder {
	private commands: Map<string, CommandDefinition<unknown, unknown>> =
		new Map();
	private logger: Logger;
	private configManager: ConfigManager<unknown> | null = null;
	private metadata: CliMetadata = {
		name: "cli",
		version: "1.0.0",
	};
	private globalMiddleware: Middleware<
		Record<string, unknown>,
		Record<string, unknown>
	>[] = [];

	constructor(logger: Logger) {
		this.logger = logger;

		this.registerCommand({
			name: "help",
			description: "Display help information",
			inputSchema: z.object({
				command: z.string().optional(),
			}),
			handler: async ({ parsedInput, context }) => {
				return { message: "Help information" };
			},
		});

		this.registerCommand({
			name: "version",
			description: "Display version information",
			inputSchema: z.object({}),
			handler: async () => {
				return { version: this.metadata.version };
			},
		});
	}

	/**
	 * Set the CLI tool metadata
	 */
	setMetadata(metadata: Partial<CliMetadata>): CliBuilder {
		this.metadata = { ...this.metadata, ...metadata };
		return this;
	}

	/**
	 * Get the CLI tool metadata
	 */
	getMetadata(): CliMetadata {
		return this.metadata;
	}

	configure<T>(options: ConfigOptions<T>): CliBuilder {
		this.configManager = new ConfigManager<T>(options, this.logger);
		return this;
	}

	use<
		MiddlewareContext extends Record<string, unknown>,
		MiddlewareMetadata extends Record<string, unknown>,
	>(
		middlewareFn:
			| MiddlewareFunction<
					unknown,
					unknown,
					MiddlewareContext,
					MiddlewareMetadata
			  >
			| Middleware<MiddlewareContext, MiddlewareMetadata>,
	): CliBuilder {
		if (typeof middlewareFn === "function") {
			// If it's a function, convert it to a middleware
			const middleware = createMiddleware<
				MiddlewareContext,
				MiddlewareMetadata
			>().define(middlewareFn);
			this.globalMiddleware.push(
				middleware as unknown as Middleware<
					Record<string, unknown>,
					Record<string, unknown>
				>,
			);
		} else {
			// If it's already a middleware object
			this.globalMiddleware.push(
				middlewareFn as unknown as Middleware<
					Record<string, unknown>,
					Record<string, unknown>
				>,
			);
		}

		return this;
	}

	add(config: CommandConfig): ActionBuilder<unknown, unknown> {
		const { command, description, group = "default", ...metadata } = config;
		const builder = new ActionBuilder(command, description || "");
		builder.setCliBuilder(this);
		builder.meta({ group, ...metadata });

		// Add global middleware to the action builder
		let builderWithMiddleware = builder;
		this.globalMiddleware.forEach((middleware) => {
			builderWithMiddleware = builderWithMiddleware.use(
				middleware as unknown as Middleware<
					Record<string, unknown>,
					Record<string, unknown>
				>,
			);
		});

		return builderWithMiddleware;
	}

	getCommands(): Map<string, CommandDefinition<unknown, unknown>> {
		return this.commands;
	}

	getConfigManager(): ConfigManager<unknown> | null {
		return this.configManager;
	}

	registerCommand(command: CommandDefinition<unknown, unknown>): void {
		this.commands.set(command.name, command);
	}

	async run(options: CliOptions = {}): Promise<void> {
		const devtool = new Devtool(this, options);
		return devtool.run();
	}
}

export class Devtool<T = unknown> {
	private config: unknown;
	private logger: Logger;
	private commands: Map<string, CommandDefinition<unknown, unknown>> =
		new Map();
	private aliases: Map<string, string> = new Map();
	private version = "1.0.0";
	private pluginManager: PluginManager | null = null;
	private configManager: ConfigManager<unknown> | null = null;
	private cliOptions: CliOptions;
	private cliBuilder: CliBuilder;
	private metadata: CliMetadata;

	// Utility method to convert space-delimited to colon-delimited format
	private toInternalCommandFormat(command: string): string {
		return command.replace(/\s+/g, ":");
	}

	// Utility method to convert colon-delimited to space-delimited format
	private toDisplayCommandFormat(command: string): string {
		return command.replace(/:/g, " ");
	}

	constructor(cliBuilder: CliBuilder, cliOptions: CliOptions = {}) {
		this.cliOptions = cliOptions;
		this.logger = new ConsoleLogger(cliOptions.debug);
		this.cliBuilder = cliBuilder;
		this.metadata = cliBuilder.getMetadata();

		this.commands = cliBuilder.getCommands();

		// Register command-specific aliases
		for (const [name, command] of Array.from(this.commands.entries())) {
			if (command.aliases && command.aliases.length > 0) {
				command.aliases.forEach((alias: string) => {
					const fullAlias = command.parent
						? `${command.parent}:${alias}`
						: alias;
					this.aliases.set(fullAlias, name);
				});
			}
		}

		if (cliOptions.pluginsDir) {
			this.pluginManager = new PluginManager(cliBuilder, this.logger);
		}

		this.configManager =
			cliBuilder.getConfigManager() as ConfigManager<unknown> | null;
	}

	async initialize(
		commandLineArgs: Record<string, unknown> = {},
	): Promise<void> {
		if (this.configManager) {
			this.config = await this.configManager.loadConfig(commandLineArgs);
		} else {
			this.config = {};
		}

		if (this.cliOptions.pluginsDir && this.pluginManager) {
			await this.pluginManager.loadPluginsFromDirectory(
				this.cliOptions.pluginsDir,
			);
		}
	}

	private parseArgs(argv: string[]): {
		command: string;
		options: Record<string, unknown>;
	} {
		if (argv.length < 3) {
			return { command: "help", options: {} };
		}

		const processArgs = argv.slice(2);

		if (processArgs.includes("--help") || processArgs.includes("-h")) {
			return { command: "help", options: {} };
		}

		if (processArgs.includes("--version") || processArgs.includes("-v")) {
			return { command: "version", options: {} };
		}

		const commandParts: string[] = [];
		let i = 0;

		// Collect all parts until we hit an option (--flag)
		while (i < processArgs.length && !processArgs[i].startsWith("--")) {
			commandParts.push(processArgs[i]);
			i++;
		}

		// Convert space-delimited command to colon-delimited format internally
		// We join the command parts with ":" to maintain backward compatibility with the internal API
		let command = this.toInternalCommandFormat(commandParts.join(" "));

		if (command === "help" && commandParts.length > 1) {
			// For help command, handle subcommand properly
			const helpTarget = this.toInternalCommandFormat(
				commandParts.slice(1).join(" "),
			);
			return {
				command: "help",
				options: { command: helpTarget },
			};
		}

		// Check if this command is an alias
		if (this.aliases.has(command)) {
			const aliasTarget = this.aliases.get(command);
			if (aliasTarget) {
				command = aliasTarget;
			}
		}

		const options: Record<string, unknown> = {};

		for (; i < processArgs.length; i++) {
			const arg = processArgs[i];

			if (arg.startsWith("--")) {
				const flag = arg.slice(2);

				if (flag.includes("=")) {
					const [key, value] = flag.split("=", 2);
					options[key] = value;
				} else if (
					i + 1 >= processArgs.length ||
					processArgs[i + 1].startsWith("--")
				) {
					options[flag] = true;
				} else {
					options[flag] = processArgs[i + 1];
					i++;
				}
			}
		}

		return { command, options };
	}

	async run(argv: string[] = process.argv): Promise<void> {
		try {
			await this.initialize();

			// Parse arguments using the actual invoked name
			const invokedBinary = path.basename(argv[1]);

			// Check if this CLI was invoked using one of its aliases
			// If it was, we'll use the metadata.name for help output
			// but still process the command as normal
			const usingAlias = this.metadata.aliases?.includes(invokedBinary);

			const { command, options } = this.parseArgs(argv);

			if (command === "help") {
				if (options.command && typeof options.command === "string") {
					// Display help for a specific command
					this.displayCommandHelp(options.command);
				} else {
					// Display general help
					this.displayHelp();
				}
				return;
			}

			if (command === "version") {
				console.log(`${this.metadata.name} v${this.metadata.version}`);
				return;
			}

			const commandAction =
				this.commands.get(command) ||
				this.commands.get(this.aliases.get(command) || "");

			if (!commandAction) {
				this.logger.error(`Unknown command: ${command}`);
				this.displayHelp();
				return;
			}

			try {
				const validated = commandAction.inputSchema.parse(options);
				const result = await commandAction.handler({
					parsedInput: validated,
					context: { logger: this.logger },
					config: this.config,
				});

				if (commandAction.outputSchema && result !== undefined) {
					commandAction.outputSchema.parse(result);
				}
			} catch (error) {
				if (error instanceof z.ZodError) {
					this.logger.error("Invalid command arguments:");
					error.errors.forEach((err) => {
						this.logger.error(`- ${err.path.join(".")}: ${err.message}`);
					});
					this.logger.info("Run with --help for usage information.");
				} else {
					this.logger.error(
						`Error executing command: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		} catch (error) {
			this.logger.error(
				`Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private displayHelp(): void {
		console.log(`${this.metadata.name} - ${this.metadata.description || ""}`);
		console.log(`Version: ${this.metadata.version || "1.0.0"}`);
		if (this.metadata.author) {
			console.log(`Author: ${this.metadata.author}`);
		}

		// Display aliases if defined
		if (this.metadata.aliases && this.metadata.aliases.length > 0) {
			console.log(`Aliases: ${this.metadata.aliases.join(", ")}`);
		}

		console.log();
		console.log(`Usage: ${this.metadata.name} <command> [options]`);

		// Show usage with aliases if defined
		if (this.metadata.aliases && this.metadata.aliases.length > 0) {
			this.metadata.aliases.forEach((alias) => {
				console.log(`   or: ${alias} <command> [options]`);
			});
		}

		console.log();
		console.log("Commands:");

		const groupedCommands = new Map<
			string,
			[string, CommandDefinition<unknown, unknown>][]
		>();

		// Group commands by their group metadata
		for (const [name, command] of Array.from(this.commands.entries())) {
			if (command.parent) {
				continue; // Skip subcommands for top-level grouping
			}

			const group = (command.metadata?.group as string) || "General";

			if (!groupedCommands.has(group)) {
				groupedCommands.set(group, []);
			}

			const commandsList = groupedCommands.get(group);
			if (commandsList) {
				commandsList.push([name, command]);
			}
		}

		// Now process each group
		for (const [group, commands] of Array.from(groupedCommands.entries())) {
			console.log(`\n${group}:`);

			// Display main commands with their direct subcommands
			for (const [name, command] of commands) {
				// Display main command with spaces instead of colons for user-facing output
				const displayName = this.toDisplayCommandFormat(name);
				console.log(`  ${displayName.padEnd(15)} ${command.description}`);

				// Find and display direct subcommands for this command
				const subcommands = Array.from(this.commands.entries())
					.filter(([subName, _cmd]) => {
						// Check if this is a direct subcommand (one level below)
						const parts = subName.split(":");
						return parts.length === 2 && parts[0] === name;
					})
					.map(([subName, cmd]) => {
						const subCommandName = subName.split(":")[1];
						return {
							fullName: subName,
							name: subCommandName,
							description: cmd.description,
						};
					});

				// Display the subcommands if any exist
				if (subcommands.length > 0) {
					subcommands.forEach((sub) => {
						// Format as "parent sub" instead of showing "parent:sub"
						const displaySubName = `${displayName} ${sub.name}`;
						console.log(`  ${displaySubName.padEnd(15)} ${sub.description}`);
					});
				}
			}
		}

		console.log(
			`\nRun '${this.metadata.name} <command> --help' for more information on a command.`,
		);
	}

	private displayCommandHelp(commandName: string): void {
		const command = this.commands.get(commandName as string);

		if (!command) {
			this.logger.error(`Unknown command: ${commandName}`);
			this.displayHelp();
			return;
		}

		// Display with spaces instead of colons for user-facing output
		const displayName = this.toDisplayCommandFormat(commandName);

		console.log(`\nCommand: ${displayName}`);
		console.log(`Description: ${command.description}`);

		// Show parent command if applicable
		if (command.parent) {
			const parentDisplayName = this.toDisplayCommandFormat(command.parent);
			console.log(`Parent: ${parentDisplayName}`);
		}

		// Display aliases if any
		if (command.aliases && command.aliases.length > 0) {
			console.log(`Aliases: ${command.aliases.join(", ")}`);
		}

		// Extract schema properties - fixed to use proper TypeScript type checking
		if (command.inputSchema && "shape" in command.inputSchema._def) {
			const schemaShape = command.inputSchema._def.shape as Record<
				string,
				z.ZodTypeAny
			>;

			console.log("\nOptions:");

			for (const [key, schema] of Object.entries(schemaShape)) {
				// Safe access to schema properties with type checking
				const isRequired = schema._def && !("isOptional" in schema._def);
				const type = this.getSchemaTypeName(schema);
				const description =
					schema._def && "description" in schema._def
						? (schema._def.description as string) || ""
						: "";

				console.log(`  --${key}${isRequired ? " (required)" : ""} <${type}>`);
				if (description) {
					console.log(`      ${description}`);
				}
			}
		}

		// Show examples if available
		if (command.examples && command.examples.length > 0) {
			console.log("\nExamples:");
			command.examples.forEach((example, index) => {
				console.log(`  Example ${index + 1}:`);
				console.log(
					`    ${this.metadata.name} ${displayName} ${this.formatExampleArgs(example)}`,
				);
			});
		}

		// List subcommands if any
		const subcommands = Array.from(this.commands.entries())
			.filter(([name, _cmd]) => name.startsWith(`${commandName}:`))
			.map(([name, cmd]) => {
				const subName = name.substring(commandName.length + 1);
				return { name: subName, fullName: name, description: cmd.description };
			});

		if (subcommands.length > 0) {
			console.log("\nSubcommands:");
			subcommands.forEach((sub) => {
				// Display as "subcommand" rather than "parent:subcommand" format
				console.log(`  ${sub.name.padEnd(15)} ${sub.description}`);

				// Show how to use the command with proper spaces
				const fullDisplayName = this.toDisplayCommandFormat(sub.fullName);
				console.log(`      Usage: ${this.metadata.name} ${fullDisplayName}`);
			});

			console.log(
				`\nUse '${this.metadata.name} help ${displayName} <subcommand>' for more information on a subcommand.`,
			);
		}
	}

	private getSchemaTypeName(schema: z.ZodTypeAny): string {
		if (!schema._def) {
			return "unknown";
		}

		const def = schema._def;

		if ("typeName" in def) {
			const typeName = def.typeName as string;
			if (typeName === "ZodString") {
				return "string";
			}
			if (typeName === "ZodNumber") {
				return "number";
			}
			if (typeName === "ZodBoolean") {
				return "boolean";
			}
			if (typeName === "ZodArray") {
				return "array";
			}
			if (typeName === "ZodObject") {
				return "object";
			}
			if (typeName === "ZodEnum" && "values" in def) {
				return (def.values as string[]).join("|");
			}
			if (typeName === "ZodOptional" && "innerType" in def) {
				return this.getSchemaTypeName(def.innerType as z.ZodTypeAny);
			}
		}

		return "unknown";
	}

	private formatExampleArgs(example: unknown): string {
		if (!example || typeof example !== "object") {
			return "";
		}

		return Object.entries(example as Record<string, unknown>)
			.map(([key, value]) => {
				if (value === true) {
					return `--${key}`;
				}
				return `--${key}=${value}`;
			})
			.join(" ");
	}
}

export function createCli(metadata?: Partial<CliMetadata>): CliBuilder {
	const logger = new ConsoleLogger();
	const cli = new CliBuilder(logger);

	if (metadata) {
		cli.setMetadata(metadata);
	}

	return cli;
}

// Example usage:
// const cli = createCli({
//   name: "devtool",
//   description: "A powerful development toolkit",
//   version: "1.0.0",
//   author: "Your Name",
//   aliases: ["dt", "devtool.sh"] // CLI tool aliases
// });

export { z };

// Validation error utility functions for next-safe-action
export interface ValidationErrors {
	_errors: string[];
	[key: string]: ValidationErrors | string[];
}

export interface FlattenedValidationErrors {
	formErrors: string[];
	fieldErrors: Record<string, string[]>;
}

/**
 * Flattens validation errors into a more manageable structure.
 * @param validationErrors The validation errors object from Zod
 * @returns A flattened version of the validation errors
 */
export function flattenValidationErrors(
	validationErrors: ValidationErrors,
): FlattenedValidationErrors {
	const { _errors, ...fieldErrors } = validationErrors;

	const flattenedFieldErrors: Record<string, string[]> = {};

	for (const [key, value] of Object.entries(fieldErrors)) {
		if (Array.isArray(value)) {
			flattenedFieldErrors[key] = value;
		} else if (typeof value === "object" && value._errors) {
			flattenedFieldErrors[key] = value._errors;
		}
	}

	return {
		formErrors: _errors || [],
		fieldErrors: flattenedFieldErrors,
	};
}

/**
 * Flattens bind args validation errors into a more manageable structure.
 * @param validationErrors The bind args validation errors array from Zod
 * @returns A flattened version of the bind args validation errors
 */
export function flattenBindArgsValidationErrors(
	validationErrors: ValidationErrors[],
): (string[] | null)[] {
	return validationErrors.map((ve) =>
		ve._errors.length > 0 ? ve._errors : null,
	);
}

/**
 * Formats validation errors similar to Zod's format method.
 * @param validationErrors The validation errors object to format
 * @returns A formatted validation errors object
 */
export function formatValidationErrors(
	validationErrors: z.ZodError,
): ValidationErrors {
	return validationErrors.format() as ValidationErrors;
}

/**
 * Formats bind args validation errors similar to Zod's format method.
 * @param validationErrors The bind args validation errors to format
 * @returns A formatted bind args validation errors array
 */
export function formatBindArgsValidationErrors(
	validationErrors: z.ZodError[],
): ValidationErrors[] {
	return validationErrors.map((ve) => ve.format() as ValidationErrors);
}

/**
 * Custom error interface for validation errors
 */
export interface ValidationError extends Error {
	code: string;
	validationErrors: ValidationErrors;
}

/**
 * Returns validation errors from within an action's server code function.
 * This function will throw an error internally, so code below it will not be executed.
 * @param schema The schema used for validation
 * @param errors Custom validation errors to return
 */
export function returnValidationErrors<T>(
	_schema: z.ZodType<T>,
	errors: ValidationErrors,
): never {
	// Create a custom error that will be caught and processed by next-safe-action
	const error = new Error("Validation failed") as ValidationError;
	error.code = "VALIDATION_ERROR";
	error.validationErrors = errors;
	throw error;
}
