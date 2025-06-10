// Use require for wikipedia since there might not be type definitions
import wikipedia from "wikipedia";
import { ZodCommand, z } from "../src";

// Create the CLI instance with metadata
const cli = new ZodCommand({
	name: "wikipedia-cli",
	description: "A CLI tool to search and retrieve information from Wikipedia",
	version: "1.0.0",
	author: "Tim Mikeladze <tim.mikeladze@gmail.com>",
	homepage: "https://github.com/timmikeladze/wikipedia-cli",
	license: "MIT",
	repository: "https://github.com/timmikeladze/wikipedia-cli",
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
			language = (config as { language: string }).language,
			limit = (config as { maxResults: number }).maxResults,
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
			const searchResults = await wikipedia.search(query, {
				limit,
			});

			// Debug: Log the actual structure
			if ((config as { verbose: boolean }).verbose) {
				console.log(
					"Raw search results:",
					JSON.stringify(searchResults, null, 2),
				);
			}

			// Display the results
			console.log(`\nSearch results for "${query}" (${language}):`);

			// Handle different possible response structures
			if (Array.isArray(searchResults)) {
				// If searchResults is directly an array
				searchResults.forEach(
					(result: string | WikipediaSearchResult, index: number) => {
						const title =
							typeof result === "string"
								? result
								: (result as WikipediaSearchResult).title || String(result);
						console.log(`${index + 1}. ${title}`);
					},
				);
				return { results: searchResults };
			}

			if (
				searchResults &&
				typeof searchResults === "object" &&
				"results" in searchResults &&
				Array.isArray((searchResults as WikipediaSearchResponse).results)
			) {
				// If searchResults has a results property
				(searchResults as WikipediaSearchResponse).results.forEach(
					(result: string | WikipediaSearchResult, index: number) => {
						const title =
							typeof result === "string"
								? result
								: (result as WikipediaSearchResult).title || String(result);
						console.log(`${index + 1}. ${title}`);
					},
				);
				return { results: (searchResults as WikipediaSearchResponse).results };
			}

			// Fallback: try to display whatever we got
			console.log("Unexpected response structure:", searchResults);
			return { results: [] };
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
		const { count = 1, language = (config as { language: string }).language } =
			parsedInput as {
				count: number;
				language: string;
			};
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
			randomArticles.forEach((article: string, _index: number) => {
				console.log(`${JSON.stringify(article, null, 2)}`);
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
