// Use require for wikipedia since there might not be type definitions
import wikipedia from "wikipedia";
import { createCli, z } from "../src";

// Create the CLI instance with metadata
const cli = createCli({
	name: "wikipedia-cli",
	description: "A CLI tool to search and retrieve information from Wikipedia",
	version: "1.0.0",
	author: "DevTool Team",
	homepage: "https://github.com/devtool/wikipedia-cli",
	license: "MIT",
	repository: "https://github.com/devtool/wikipedia-cli",
});

// Configure basic settings for this example
cli.configure({
	schema: z.object({
		language: z.string().default("en"),
		maxResults: z.number().default(5),
		verbose: z.boolean().default(false),
	}),
	defaults: {
		language: "en",
		maxResults: 5,
		verbose: false,
	},
});

// Wikipedia types to help with TypeScript
interface WikipediaSearchResult {
	title: string;
	pageid: number;
	[key: string]: unknown;
}

interface WikipediaSearchResponse {
	results: WikipediaSearchResult[];
	suggestion?: string;
}

interface WikipediaSummary {
	title: string;
	extract: string;
	[key: string]: unknown;
}

interface WikipediaPageInfo {
	title: string;
	pageid: number;
	touched: string;
	[key: string]: unknown;
}

// Main wikipedia command
cli
	.add({
		command: "wiki",
		description: "Search and retrieve information from Wikipedia",
		title: "Wikipedia Tools",
		group: "Knowledge",
	})
	.input(
		z.object({
			query: z.string().describe("The search term to look up on Wikipedia"),
			language: z
				.string()
				.optional()
				.describe("Language code (e.g., 'en', 'fr', 'es')"),
			limit: z
				.number()
				.optional()
				.describe("Maximum number of results to return"),
		}),
	)
	.action(async ({ parsedInput, context, config }) => {
		const {
			query,
			language = config.language,
			limit = config.maxResults,
		} = parsedInput as {
			query: string;
			language: string;
			limit: number;
		};
		context.logger.info(`Searching Wikipedia for: ${query}`);

		try {
			// Set the Wikipedia API language
			wikipedia.setLang(language);

			// Search for the query
			const searchResults = (await wikipedia.search(query, {
				limit,
			})) as WikipediaSearchResponse;

			// Display the results
			console.log(`\nSearch results for "${query}" (${language}):`);
			searchResults.results.forEach(
				(result: WikipediaSearchResult, index: number) => {
					console.log(`${index + 1}. ${result.title}`);
				},
			);

			return { results: searchResults.results };
		} catch (error) {
			context.logger.error(
				`Error searching Wikipedia: ${error instanceof Error ? error.message : String(error)}`,
			);
			return { error: true };
		}
	});

// Subcommand for getting random articles
cli
	.add({
		command: "wiki:random",
		description: "Get random articles from Wikipedia",
		group: "Knowledge",
	})
	.input(
		z.object({
			count: z
				.number()
				.optional()
				.describe("Number of random articles to fetch"),
			language: z
				.string()
				.optional()
				.describe("Language code (e.g., 'en', 'fr', 'es')"),
		}),
	)
	.action(async ({ parsedInput, context, config }) => {
		const { count = 1, language = config.language } = parsedInput;
		context.logger.info(`Fetching ${count} random Wikipedia articles`);

		try {
			// Set the Wikipedia API language
			wikipedia.setLang(language);

			// Get random articles
			const randomArticles: string[] = [];

			for (let i = 0; i < count; i++) {
				const random = (await wikipedia.random()) as string;
				randomArticles.push(random);
			}

			// Display the results
			console.log(`\nRandom Wikipedia Articles (${language}):`);
			randomArticles.forEach((article: string, index: number) => {
				console.log(`${index + 1}. ${article}`);
			});

			return { articles: randomArticles };
		} catch (error) {
			context.logger.error(
				`Error fetching random articles: ${error instanceof Error ? error.message : String(error)}`,
			);
			return { error: true };
		}
	});

cli.run();
