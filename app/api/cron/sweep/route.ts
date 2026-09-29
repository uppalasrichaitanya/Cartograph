import { handleSweep } from "@/lib/api/sweep";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handleSweep(request, getStorage(), new Date(), process.env.CRON_SECRET);
}
