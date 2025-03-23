import { createCli } from ".";

if (require.main === module) {
	const cli = createCli({
		name: "devtool.sh",
		version: "1.0.0",
		description: "A CLI framework for building powerful command-line tools",
		aliases: ["devtool", "dt"],
	});

	cli.run();
}
