import { proxyV1 } from "@/lib/v1-proxy";

export const revalidate = 300;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyV1(request, `/api/validators/${encodeURIComponent(id)}/simulate`);
}
