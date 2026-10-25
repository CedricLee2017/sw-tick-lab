import { optimize, type OptRequest, type OptResult } from "./optimizer";

self.onmessage = (e: MessageEvent<{ id: number; req: OptRequest }>) => {
  const { id, req } = e.data;
  try {
    const res: OptResult = optimize(req);
    (self as unknown as Worker).postMessage({ id, res });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
