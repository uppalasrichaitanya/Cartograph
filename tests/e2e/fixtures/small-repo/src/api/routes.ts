import { runJob } from "../core/jobs";
import { render } from "../ui/view";
export const routes = () => render(runJob());
