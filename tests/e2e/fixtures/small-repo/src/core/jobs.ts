import { queue } from "./queue";
import { config } from "./config";
export const runJob = () => queue(config.name);
