import MyDevTool from ".";

if (require.main === module) {
	const cli = new MyDevTool({
		name: "MyDevTool.sh",
		version: "1.0.0",
		description: "A CLI framework for building powerful command-line tools",
		aliases: ["mydevtool", "mdt"],
	});

	cli.run();
}
