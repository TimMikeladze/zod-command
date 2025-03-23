import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import * as yaml from "js-yaml";
import { z } from "zod";

// Disable 'any' type warnings for this file as we're focusing on fixing downlevelIteration
/* eslint-disable @typescript-eslint/no-explicit-any */

// Core types
type CommandHandler<T, R = any> = (args: {
	parsedInput: T;
	context: CommandContext;
	config: any;
}) => Promise<R> | R;

interface CommandContext {
	logger: Logger;
}

interface CommandDefinition<T, R = any> {
	name: string;
	description: string;
	inputSchema: z.ZodType<T>;
	outputSchema?: z.ZodType<R>;
	metadata?: Record<string, any>;
	handler: CommandHandler<T, R>;
	aliases?: string[];
	examples?: T[];
	subcommands?: CommandDefinition<any, any>[];
	parent?: string;
}

interface CommandConfig {
	command: string;
	description?: string;
	title?: string;
	group?: string;
	tags?: string[];
	[key: string]: any;
}

interface Logger {
	info: (message: string) => void;
	error: (message: string) => void;
	warn: (message: string) => void;
	success: (message: string) => void;
	debug: (message: string) => void;
}

class ConsoleLogger implements Logger {
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

interface Plugin {
	name: string;
	version: string;
	description?: string;
	author?: string;
	initialize: (cli: CliBuilder) => void;
}

const pluginManifestSchema = z.object({
	name: z.string(),
	version: z.string(),
	description: z.string().optional(),
	author: z.string().optional(),
	main: z.string(),
	type: z.enum(["typescript", "javascript"]).default("javascript"),
});

type PluginManifest = z.infer<typeof pluginManifestSchema>;

interface ConfigOptions<T> {
	schema: z.ZodType<T>;
	configFiles?: string[];
	envPrefix?: string;
	defaults?: Partial<T>;
}

interface CliOptions {
	debug?: boolean;
	pluginsDir?: string;
}

// Define a type for configuration values - simplify to avoid type issues
type ConfigValue = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface ConfigObject {
	[key: string]: ConfigValue;
}

interface ConfigLoader {
	canLoad(filePath: string): boolean;
	load(filePath: string): ConfigObject;
}

class JsConfigLoader implements ConfigLoader {
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

class TsConfigLoader implements ConfigLoader {
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

class JsonConfigLoader implements ConfigLoader {
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

class YamlConfigLoader implements ConfigLoader {
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

class ConfigLoaderRegistry {
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

class PluginManager {
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

class ConfigManager<T> {
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
					current = current[segment];
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

class ActionBuilder<T = any, R = any> {
	private name = "";
	private description = "";
	private inputZodSchema: z.ZodType<T> | null = null;
	private outputZodSchema: z.ZodType<R> | null = null;
	private commandMetadata: Record<string, any> = {};
	private handlerFn: CommandHandler<T, R> | null = null;
	private commandAliases: string[] = [];
	private commandExamples: T[] = [];
	private commandSubcommands: CommandDefinition<any, any>[] = [];
	private parentCommand: string | undefined = undefined;
	private cliBuilder: CliBuilder | null = null;

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
		return newBuilder;
	}

	meta(metadata: Record<string, any>): ActionBuilder<T, R> {
		this.commandMetadata = { ...this.commandMetadata, ...metadata };
		return this;
	}

	examples(examples: T[]): ActionBuilder<T, R> {
		this.commandExamples = examples;
		return this;
	}

	action<NewR>(handler: CommandHandler<T, NewR>): CommandDefinition<T, NewR> {
		if (!this.name) {
			throw new Error("Command name is required");
		}

		if (!this.inputZodSchema) {
			throw new Error("Command input schema is required");
		}

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
			handler: handler,
			aliases: this.commandAliases,
			examples: this.commandExamples,
			subcommands: this.commandSubcommands,
			parent: this.parentCommand,
		};

		if (this.cliBuilder) {
			this.cliBuilder.registerCommand(command);
		}

		return command;
	}

	sub(nameOrConfig: string | CommandConfig): ActionBuilder<any, any> {
		if (typeof nameOrConfig === "string") {
			const subBuilder = new ActionBuilder(nameOrConfig, "", this.name);
			subBuilder.cliBuilder = this.cliBuilder;

			const fullName = this.name
				? `${this.name}:${nameOrConfig}`
				: nameOrConfig;
			subBuilder.name = fullName;

			subBuilder.commandMetadata = { group: "default" };

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

		const fullName = this.name ? `${this.name}:${command}` : command;
		subBuilder.name = fullName;

		subBuilder.commandMetadata = {
			group,
			...restMetadata,
		};

		return subBuilder;
	}
}

class CliBuilder {
	private commands: Map<string, CommandDefinition<any, any>> = new Map();
	private logger: Logger;
	private configManager: ConfigManager<any> | null = null;

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
				return { version: "1.0.0" };
			},
		});
	}

	configure<T>(options: ConfigOptions<T>): CliBuilder {
		this.configManager = new ConfigManager<T>(options, this.logger);
		return this;
	}

	add(config: CommandConfig): ActionBuilder<any, any> {
		const { command, description, group = "default", ...metadata } = config;
		const builder = new ActionBuilder(command, description || "");
		builder.setCliBuilder(this);
		builder.meta({ group, ...metadata });
		return builder;
	}

	getCommands(): Map<string, CommandDefinition<any, any>> {
		return this.commands;
	}

	getConfigManager(): ConfigManager<any> | null {
		return this.configManager;
	}

	registerCommand(command: CommandDefinition<any, any>): void {
		this.commands.set(command.name, command);
	}

	async run(options: CliOptions = {}): Promise<void> {
		const devtool = new Devtool(this, options);
		return devtool.run();
	}
}

class Devtool<T> {
	private config: any;
	private logger: Logger;
	private commands: Map<string, CommandDefinition<any, any>> = new Map();
	private aliases: Map<string, string> = new Map();
	private version = "1.0.0";
	private pluginManager: PluginManager | null = null;
	private configManager: ConfigManager<T> | null = null;
	private cliOptions: CliOptions;
	private cliBuilder: CliBuilder;

	constructor(cliBuilder: CliBuilder, cliOptions: CliOptions = {}) {
		this.cliOptions = cliOptions;
		this.logger = new ConsoleLogger(cliOptions.debug);
		this.cliBuilder = cliBuilder;

		this.commands = cliBuilder.getCommands();

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

		this.configManager = cliBuilder.getConfigManager();
	}

	async initialize(commandLineArgs: Record<string, any> = {}): Promise<void> {
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
		options: Record<string, any>;
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

		while (i < processArgs.length && !processArgs[i].startsWith("--")) {
			commandParts.push(processArgs[i]);
			i++;
		}

		let command = commandParts.join(":");

		if (command === "help" && commandParts.length > 1) {
			return {
				command: "help",
				options: { command: commandParts.slice(1).join(":") },
			};
		}

		if (this.aliases.has(command)) {
			const aliasTarget = this.aliases.get(command);
			if (aliasTarget) {
				command = aliasTarget;
			}
		}

		const options: Record<string, any> = {};

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

			const { command, options } = this.parseArgs(argv);

			if (command === "help") {
				this.displayHelp();
				return;
			}

			if (command === "version") {
				console.log(`v${this.version}`);
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
		console.log("Usage: devtool <command> [options]");
		console.log();
		console.log("Commands:");

		const groupedCommands = new Map<
			string,
			[string, CommandDefinition<any, any>][]
		>();

		for (const [name, command] of Array.from(this.commands.entries())) {
			if (command.parent) {
				continue; // Skip subcommands for top-level help
			}

			const group = command.metadata?.group || "General";
			if (!groupedCommands.has(group)) {
				groupedCommands.set(group, []);
			}
			const commandsList = groupedCommands.get(group);
			if (commandsList) {
				commandsList.push([name, command]);
			}
		}

		for (const [group, commands] of Array.from(groupedCommands.entries())) {
			console.log(`\n${group}:`);
			for (const [name, command] of commands) {
				console.log(`  ${name.padEnd(15)} ${command.description}`);
			}
		}

		console.log(
			`\nRun 'devtool <command> --help' for more information on a command.`,
		);
	}
}

function createCli(): CliBuilder {
	const logger = new ConsoleLogger();
	return new CliBuilder(logger);
}

export {
	createCli,
	z,
	type CommandDefinition,
	type CommandHandler,
	type CommandContext,
	type Plugin,
	type ConfigLoader,
	type Logger,
};
