import { runJob } from "./jobs";
export const queue = (name: string) => name + String(typeof runJob);
