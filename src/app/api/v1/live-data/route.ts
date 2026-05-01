import { proxyV1 } from "@/lib/v1-proxy";

export const revalidate = 60;

export async function GET(request: Request) {
  return proxyV1(request, "/api/live-data");
}
