import { CliBuilder } from ".";

import { ConsoleLogger } from ".";

if (require.main === module) {
	new CliBuilder(new ConsoleLogger()).run();
}
