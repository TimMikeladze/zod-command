import ZodCommand from ".";

if (require.main === module) {
	const cli = new ZodCommand({
		name: "zod-command",
		version: "1.0.0",
		description: "A CLI framework for building powerful command-line tools",
		aliases: ["zod-command", "zc"],
	});

	cli.run();
}
