
// Use require for wikipedia since there might not be type definitions
import wikipedia from "wikipedia";
import { createCli, z } from "../src";

// Create the CLI instance
const cli = createCli();

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
		} = parsedInput;
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

// Subcommand for getting a specific page
cli
	.add({
		command: "wiki:page",
		description: "Get detailed information about a specific Wikipedia page",
		group: "Knowledge",
	})
	.input(
		z.object({
			title: z.string().describe("The title of the Wikipedia page"),
			language: z
				.string()
				.optional()
				.describe("Language code (e.g., 'en', 'fr', 'es')"),
			summary: z.boolean().optional().describe("Only return the summary"),
		}),
	)
	.action(async ({ parsedInput, context, config }) => {
		const { title, language = config.language, summary = false } = parsedInput;
		context.logger.info(`Fetching Wikipedia page: ${title}`);

		try {
			// Set the Wikipedia API language
			wikipedia.setLang(language);

			// Get the page
			const page = await wikipedia.page(title);

			if (summary) {
				// Get only the summary
				const pageSummary =
					(await page.summary()) as unknown as WikipediaSummary;
				console.log(`\n# ${pageSummary.title}`);
				console.log(`\n${pageSummary.extract}`);

				return { title: pageSummary.title, summary: pageSummary.extract };
			}

			// Get the full content
			const [pageInfo, pageContent] = await Promise.all([
				page.info() as unknown as Promise<WikipediaPageInfo>,
				page.content() as Promise<string>,
			]);

			console.log(`\n# ${pageInfo.title}`);

			if (config.verbose) {
				console.log(`\nPage ID: ${pageInfo.pageid}`);
				console.log(
					`Last Edited: ${new Date(pageInfo.touched).toLocaleString()}`,
				);
			}

			// Display a truncated version of the content
			const contentPreview =
				pageContent.substring(0, 500) + (pageContent.length > 500 ? "..." : "");
			console.log(`\n${contentPreview}`);

			return {
				title: pageInfo.title,
				id: pageInfo.pageid,
				content: contentPreview,
				lastEdited: pageInfo.touched,
			};
		} catch (error) {
			context.logger.error(
				`Error fetching Wikipedia page: ${error instanceof Error ? error.message : String(error)}`,
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

// Subcommand for advanced search with more options
cli
	.add({
		command: "wiki:search",
		description: "Advanced search for Wikipedia articles",
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
			fullText: z.boolean().optional().describe("Enable full-text search"),
		}),
	)
	.action(async ({ parsedInput, context, config }) => {
		const {
			query,
			language = config.language,
			limit = config.maxResults,
			fullText = false,
		} = parsedInput;

		context.logger.info(`Performing advanced search for: ${query}`);

		try {
			// Set the Wikipedia API language
			wikipedia.setLang(language);

			// Perform the search
			const searchResults = (await wikipedia.search(query, {
				limit,
				suggestion: true,
			})) as WikipediaSearchResponse;

			// Display the results with more details
			console.log(`\nAdvanced search results for "${query}" (${language}):`);

			if (searchResults.suggestion) {
				console.log(`\nDid you mean: ${searchResults.suggestion}?`);
			}

			for (let i = 0; i < searchResults.results.length; i++) {
				const result = searchResults.results[i];
				console.log(`\n${i + 1}. ${result.title}`);

				// Get a summary for each result if verbose mode is enabled
				if (config.verbose) {
					try {
						const page = await wikipedia.page(result.title);
						const summary =
							(await page.summary()) as unknown as WikipediaSummary;
						console.log(`   ${summary.extract.substring(0, 150)}...`);
					} catch (e) {
						console.log("   (Summary not available)");
					}
				}
			}

			return {
				results: searchResults.results,
				suggestion: searchResults.suggestion,
			};
		} catch (error) {
			context.logger.error(
				`Error performing advanced search: ${error instanceof Error ? error.message : String(error)}`,
			);
			return { error: true };
		}
	});

cli.run();
