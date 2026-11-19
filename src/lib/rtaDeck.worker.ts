import { planRtaDeck, type RtaDeckPlanProgress, type RtaDeckPlanRequest } from "./rtaDeckPlan";

self.onmessage = (e: MessageEvent<{ id: number; req: RtaDeckPlanRequest }>) => {
  const { id, req } = e.data;
  try {
    const out = planRtaDeck(req, (progress: RtaDeckPlanProgress) => {
      (self as unknown as Worker).postMessage({ id, progress });
    });
    (self as unknown as Worker).postMessage({ id, out });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
