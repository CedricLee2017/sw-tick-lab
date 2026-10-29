import { optimizeTeam, type TeamProgress, type TeamRequest } from "./teamOptimizer";

self.onmessage = (e: MessageEvent<{ id: number; req: TeamRequest }>) => {
  const { id, req } = e.data;
  try {
    const out = optimizeTeam(req, (progress: TeamProgress) => {
      (self as unknown as Worker).postMessage({ id, progress });
    });
    (self as unknown as Worker).postMessage({ id, out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
